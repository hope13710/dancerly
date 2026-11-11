// generate-recap: turns rehearsal notes into a short AI recap, then saves it.
//   Personal recap ("Just me")  notes read with the caller's own token, so row level security decides what goes in.
//                               Yours until you share it.
//   Team recap (whole project)  one per practice, visible to everyone on the project, built only from team-visible notes.
//                               Written on schedule (see migration 049: 3 hours before each rehearsal, or Monday 8 AM
//                               for projects without rehearsals on the calendar), and updated by any member when new
//                               feedback comes in. Two people asking for the same thing get the same recap.
//   Translate                   a team recap someone reads in another language gets a translation saved next to it.
// Every recap item must cite notes from the input; anything citing an unknown note is dropped.
import Anthropic from "npm:@anthropic-ai/sdk@0.132.1";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const MODEL = "claude-haiku-5-5";
const MAX_NOTES = 400;
const DAY = 86_400_000;
const HOUR = 3_600_000;
// Recaps are free and unlimited for people. A quiet safety cap per person per day keeps a stuck button or a script
// from running up the AI bill; nobody practicing normally comes close. Cached recaps and the sample don't count.
// The monthly count is still kept (and returned as usage) for a future plan; set RECAP_LIMIT_ENFORCED=true to enforce it.
const FREE_RECAPS_PER_MONTH = 3;
const ENFORCE_LIMIT = Deno.env.get("RECAP_LIMIT_ENFORCED") === "true";
const DAILY_SAFETY_CAP = 20;
// The schedule.
const BEFORE_REHEARSAL = 3 * HOUR; // the team recap is ready this long before a rehearsal starts
const WEEKLY_HOUR = 8; // Monday, in the owner's time zone, for projects without rehearsals on the calendar
const WEEKLY_ZONE = "America/New_York"; // when the owner's time zone isn't saved yet
const MIN_NOTES = 3; // fewer than this, the notes themselves are quicker to read than a recap
const MAX_LOOKBACK = 14 * DAY;
const MAX_PER_RUN = 4; // generations per scheduled run; the rest wait 15 minutes for the next one

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Section = "worked_on" | "next" | "landed" | "recurring";
const SECTIONS: Section[] = ["worked_on", "next", "landed", "recurring"];

const item = {
  type: "object",
  properties: {
    text: { type: "string" },
    cites: { type: "array", items: { type: "string" } },
  },
  required: ["text", "cites"],
  additionalProperties: false,
};
const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    worked_on: { type: "array", items: item },
    next: { type: "array", items: item },
    landed: { type: "array", items: item },
    recurring: { type: "array", items: item },
  },
  required: ["headline", "worked_on", "next", "landed", "recurring"],
  additionalProperties: false,
};
const strings = { type: "array", items: { type: "string" } };
const TRANSLATION_SCHEMA = {
  type: "object",
  properties: { headline: { type: "string" }, worked_on: strings, next: strings, landed: strings, recurring: strings },
  required: ["headline", "worked_on", "next", "landed", "recurring"],
  additionalProperties: false,
};

const SYSTEM = `You write rehearsal recaps for a dance team. The input is the timestamped feedback notes teammates left on rehearsal videos during one period.

Write a recap a dancer can read in under a minute before the next rehearsal:
- headline: one plain sentence on where things stand.
- worked_on: what the notes were about (2-4 items).
- next: concrete things to practice next, most important first (2-5 items). Phrase each as an action ("Hit the 5-6 arm accent on the beat").
- landed: what got fixed or praised (0-3 items). Resolved notes and praise belong here.
- recurring: issues raised more than once, by several people, or across takes (0-3 items). Say how many people or takes when it matters ("3 people flagged it").

Rules:
- Every item cites the note refs it is based on, e.g. ["n3", "n7"]. Use only refs that appear in the input. Never state anything the notes don't support.
- Weigh notes with more agrees and notes several people made more heavily.
- Use dance vocabulary from the notes as written (counts like "5-6", section names, people's names). Keep each item to one sentence.
- Write for the audience given in the request ("you" for a personal recap, "the team" for a project recap).
- Empty sections are fine. Don't pad.`;

const TRANSLATE_SYSTEM = `You translate a dance team's rehearsal recap. Keep the meaning, tone, and order exactly; one output string per input string, same count in every list.
Keep people's names, counts like "5-6", section names, and dance terms as written. Korean output uses natural, friendly 해요체.`;

const NOTE_COLUMNS = "id, body, status, t_start, t_end, author_id, private_to, created_at, updated_at, video_id, take_id, note_reactions(user_id)";

const url = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// deno-lint-ignore no-explicit-any
type Note = any;
type Built = { content: Record<string, unknown>; sources: Record<string, unknown>[]; has_private: boolean; model: string; notes_up_to: string; note_count: number };
class Fail extends Error { constructor(message: string, public status: number) { super(message); } }

const upTo = (notes: Note[]) => notes.reduce((max, n) => (n.updated_at > max ? n.updated_at : max), notes[0].updated_at);

function ai(): Anthropic {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Fail("AI recaps aren’t switched on yet. The project owner needs to add the AI key in Supabase.", 503);
  return new Anthropic({ apiKey });
}

// deno-lint-ignore no-explicit-any
async function ask(system: string, user: string, schema: unknown): Promise<{ parsed: any; model: string }> {
  // deno-lint-ignore no-explicit-any
  let response: any;
  try {
    // Haiku 5.5 thinks adaptively by default; low effort keeps a recap fast and cheap.
    // It has no server-side refusal fallback, so a decline is reported to the user below.
    response = await ai().messages.create({
      model: MODEL,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low", format: { type: "json_schema", schema } },
    });
  } catch (err) {
    if (err instanceof Fail) throw err;
    if (err instanceof Anthropic.RateLimitError) throw new Fail("The AI is busy. Try again in a minute.", 429);
    if (err instanceof Anthropic.AuthenticationError) throw new Fail("The AI key isn’t valid. Ask the project owner to check it.", 503);
    if (err instanceof Anthropic.APIError) throw new Fail(`The AI couldn’t write this recap (${err.status}). Try again.`, 502);
    throw new Fail("Couldn’t reach the AI. Try again.", 502);
  }
  if (response.stop_reason === "refusal") throw new Fail("The AI couldn’t write a recap for these notes.", 422);
  if (response.stop_reason === "max_tokens") throw new Fail("The recap ran too long. Try a shorter period.", 422);
  const text = response.content.find((b: { type: string }) => b.type === "text")?.text;
  try { return { parsed: JSON.parse(text ?? ""), model: response.model ?? MODEL }; }
  catch { throw new Fail("The AI returned something unreadable. Try again.", 502); }
}

// The notes in, the recap out (not saved yet).
async function build(o: { notes: Note[]; db: SupabaseClient; scope: "me" | "project"; projectTitle: string; me?: string; lang: string; start: Date; end: Date }): Promise<Built> {
  const { notes, scope, lang } = o;
  const ids = [...new Set(notes.map((n) => n.author_id))];
  const { data: profiles } = await o.db.from("profiles").select("id, display_name").in("id", o.me ? [...ids, o.me] : ids);
  const nameOf = Object.fromEntries((profiles ?? []).map((p: { id: string; display_name: string }) => [p.id, p.display_name]));
  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const sources = notes.map((n, i) => ({
    ref: `n${i + 1}`,
    note_id: n.id,
    body: n.body,
    status: n.status,
    t_start: Number(n.t_start),
    t_end: n.t_end === null ? null : Number(n.t_end),
    video_id: n.video_id,
    video_title: n.videos?.title ?? "",
    take_number: n.takes?.number ?? null,
    author: nameOf[n.author_id] ?? "A teammate",
    agrees: (n.note_reactions ?? []).length,
  }));
  const lines = sources.map((s) =>
    `[${s.ref}] ${s.video_title} · Take ${s.take_number} · ${fmt(s.t_start)}${s.t_end === null ? "" : `–${fmt(s.t_end)}`} · by ${s.author} · ${s.status}${s.agrees ? ` · ${s.agrees} agree` : ""}\n${s.body}`);
  const audience = scope === "me"
    ? `Personal recap for ${nameOf[o.me ?? ""] ?? "this dancer"}: notes they wrote, notes on their takes or videos, and notes that @mention them. Address them as "you".`
    : `Whole-project recap for everyone on "${o.projectTitle}". Address the team.`;
  const language = lang === "ko" ? "\nWrite every headline and item in natural, friendly Korean (해요체). Keep counts, names, and dance terms as the notes wrote them." : "";
  const user = `${audience}${language}\nPeriod: ${o.start.toISOString().slice(0, 10)} to ${o.end.toISOString().slice(0, 10)}.\n\nNotes (${sources.length}):\n\n${lines.join("\n\n")}`;
  const { parsed, model } = await ask(SYSTEM, user, SCHEMA);

  // Grounding: keep only items whose citations are real notes from the input.
  const known = new Set(sources.map((s) => s.ref));
  const content: Record<string, unknown> = { headline: String(parsed.headline ?? "").slice(0, 300), lang };
  for (const key of SECTIONS) {
    content[key] = (Array.isArray(parsed[key]) ? parsed[key] : [])
      .filter((it: { text?: string; cites?: string[] }) => it?.text && Array.isArray(it.cites) && it.cites.length && it.cites.every((c) => known.has(c)))
      .map((it: { text: string; cites: string[] }) => ({ text: it.text.slice(0, 400), cites: [...new Set(it.cites)] }));
  }
  const cited = new Set(SECTIONS.flatMap((k) => (content[k] as { cites: string[] }[]).flatMap((it) => it.cites)));
  return {
    content,
    sources: sources.filter((s) => cited.has(s.ref)),
    has_private: sources.some((s, i) => cited.has(s.ref) && notes[i].private_to),
    model,
    notes_up_to: upTo(notes),
    note_count: notes.length,
  };
}

// Team-visible notes of a project in a window, read with the service role (for the schedule), skipping anything
// in the trash, exactly as row level security would for a member.
async function teamNotes(projectId: string, start: Date, end: Date, videoId: string | null = null): Promise<Note[]> {
  let q = admin.from("notes")
    .select(`${NOTE_COLUMNS}, takes!inner(number, uploaded_by, deleted_at), videos!inner(title, created_by, deleted_at)`)
    .eq("project_id", projectId).is("private_to", null)
    .gte("created_at", start.toISOString()).lte("created_at", end.toISOString())
    .order("created_at", { ascending: true }).limit(MAX_NOTES);
  if (videoId) q = q.eq("video_id", videoId);
  const { data, error } = await q;
  if (error) throw new Fail(error.message, 500);
  return (data ?? []).filter((n: Note) => !n.takes?.deleted_at && !n.videos?.deleted_at);
}

// ---------- The schedule ----------
const zoned = (zone: string, d: Date) => {
  const parts = (z: string) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: z, weekday: "short", hour: "numeric", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).map((p) => [p.type, p.value]));
  let p: Record<string, string>;
  try { p = parts(zone); } catch { p = parts(WEEKLY_ZONE); }
  return { weekday: p.weekday, hour: Number(p.hour), date: `${p.year}-${p.month}-${p.day}` };
};

async function runSchedule() {
  const now = new Date();
  // Only projects with team feedback in the last two weeks can need a recap.
  const { data: recent } = await admin.from("notes").select("project_id").is("private_to", null)
    .gte("created_at", new Date(now.getTime() - MAX_LOOKBACK).toISOString()).limit(5000);
  const active = [...new Set((recent ?? []).map((n: { project_id: string }) => n.project_id))];
  if (!active.length) return { checked: 0, made: [] };
  const { data: projects } = await admin.from("projects").select("id, title, created_by")
    .in("id", active).eq("auto_recap", true).eq("is_sample", false).is("deleted_at", null);
  if (!projects?.length) return { checked: 0, made: [] };
  const ids = projects.map((p) => p.id);
  const owners = [...new Set(projects.map((p) => p.created_by))];
  const [{ data: events }, { data: settings }, { data: done }] = await Promise.all([
    admin.from("project_events").select("id, project_id, starts_at").eq("kind", "rehearsal").in("project_id", ids)
      .gte("starts_at", new Date(now.getTime() - MAX_LOOKBACK).toISOString()).lte("starts_at", new Date(now.getTime() + 7 * DAY).toISOString())
      .order("starts_at", { ascending: true }),
    admin.from("notification_settings").select("user_id, timezone, lang").in("user_id", owners),
    admin.from("recaps").select("project_id, cycle").eq("team", true).eq("auto", true).in("project_id", ids)
      .gte("created_at", new Date(now.getTime() - MAX_LOOKBACK).toISOString()),
  ]);
  const made = new Set((done ?? []).map((r: { project_id: string; cycle: string }) => `${r.project_id}|${r.cycle}`));
  const settingOf = Object.fromEntries((settings ?? []).map((s: { user_id: string }) => [s.user_id, s]));
  const out: unknown[] = [];
  let generated = 0;
  for (const p of projects) {
    if (generated >= MAX_PER_RUN) break;
    const rehearsals = (events ?? []).filter((e: { project_id: string }) => e.project_id === p.id);
    const setting = settingOf[p.created_by] ?? {};
    const lang = setting.lang === "ko" ? "ko" : "en";
    let cycle: string | null = null;
    let start: Date | null = null;
    // Before a rehearsal: the next one starting within 3 hours, covering feedback since the one before it.
    const upcoming = rehearsals.find((e: { starts_at: string }) => {
      const t = new Date(e.starts_at).getTime();
      return t > now.getTime() && t - now.getTime() <= BEFORE_REHEARSAL;
    });
    if (upcoming) {
      cycle = `rehearsal:${upcoming.id}`;
      const before = rehearsals.filter((e: { starts_at: string }) => new Date(e.starts_at).getTime() < new Date(upcoming.starts_at).getTime() - HOUR).pop();
      start = before ? new Date(before.starts_at) : new Date(now.getTime() - 7 * DAY);
    } else {
      // No rehearsals on the calendar around now: Monday morning, the past week.
      const soon = rehearsals.some((e: { starts_at: string }) => Math.abs(new Date(e.starts_at).getTime() - now.getTime()) <= 7 * DAY);
      const local = zoned(setting.timezone || WEEKLY_ZONE, now);
      if (!soon && local.weekday === "Mon" && local.hour >= WEEKLY_HOUR && local.hour < WEEKLY_HOUR + 4) {
        cycle = `week:${local.date}`;
        start = new Date(now.getTime() - 7 * DAY);
      }
    }
    if (!cycle || !start || made.has(`${p.id}|${cycle}`)) continue;
    start = new Date(Math.max(start.getTime(), now.getTime() - MAX_LOOKBACK));
    const notes = await teamNotes(p.id, start, now);
    if (notes.length < MIN_NOTES) continue; // checked again next run, in case the team is still writing
    generated++;
    try {
      const b = await build({ notes, db: admin, scope: "project", projectTitle: p.title, lang, start, end: now });
      const { error } = await admin.from("recaps").insert({
        project_id: p.id, created_by: p.created_by, scope: "project", period: "custom",
        period_start: start.toISOString(), period_end: now.toISOString(), video_id: null,
        team: true, auto: true, cycle, ...b,
      });
      out.push({ project: p.id, cycle, ok: !error, error: error?.code === "23505" ? "already made" : error?.message });
    } catch (err) {
      out.push({ project: p.id, cycle, ok: false, error: (err as Error).message });
    }
  }
  return { checked: projects.length, made: out };
}

// ---------- Translation of a recap someone reads in another language ----------
async function translate(asUser: SupabaseClient, recapId: string, lang: string) {
  const { data: r } = await asUser.from("recaps").select("*").eq("id", recapId).maybeSingle();
  if (!r) throw new Fail("This recap isn’t available.", 404);
  if (r.content?.lang === lang || r.content?.translations?.[lang]) return r;
  const source = { headline: r.content?.headline ?? "", ...Object.fromEntries(SECTIONS.map((k) => [k, (r.content?.[k] ?? []).map((it: { text: string }) => it.text)])) };
  const target = lang === "ko" ? "Korean" : "English";
  const { parsed } = await ask(TRANSLATE_SYSTEM, `Translate into ${target}:\n${JSON.stringify(source)}`, TRANSLATION_SCHEMA);
  const t: Record<string, unknown> = { headline: String(parsed.headline ?? "").slice(0, 300) };
  for (const k of SECTIONS) {
    const out = Array.isArray(parsed[k]) ? parsed[k] : [];
    // Same count as the original or it isn't trusted; items without a translation keep the original words.
    t[k] = (source[k] as string[]).map((orig, i) => String((out.length === (source[k] as string[]).length ? out[i] : orig) || orig).slice(0, 400));
  }
  const content = { ...r.content, translations: { ...(r.content?.translations ?? {}), [lang]: t } };
  const { data: saved, error } = await admin.from("recaps").update({ content }).eq("id", r.id).select("*").single();
  if (error) throw new Fail(error.message, 500);
  return saved;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  // The 15-minute schedule (pg_cron), checked against the database secret.
  const cronHeader = req.headers.get("x-cron-secret");
  if (cronHeader) {
    const { data: secret } = await admin.rpc("email_cron_secret");
    if (!secret || cronHeader !== secret) return json({ error: "forbidden" }, 403);
    try { return json(await runSchedule()); } catch (err) { return json({ error: (err as Error).message }, 500); }
  }

  const auth = req.headers.get("Authorization") ?? "";
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Your session ended. Log in again." }, 401);
  const me = userData.user.id;

  let body: { project_id?: string; scope?: string; period?: string; from?: string; to?: string; video_id?: string | null; lang?: string; usage_only?: boolean;
    exclude_private?: boolean; range?: { from?: string; to?: string }; update_of?: string; translate?: string };
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  const lang = body.lang === "ko" ? "ko" : "en";

  try {
    if (body.translate) return json({ recap: await translate(asUser, body.translate, lang) });

    // ---------- This month's free recaps (counted from the product_events log, which people can't edit) ----------
    const now0 = new Date();
    const monthStart = new Date(Date.UTC(now0.getUTCFullYear(), now0.getUTCMonth(), 1));
    const resets = new Date(Date.UTC(now0.getUTCFullYear(), now0.getUTCMonth() + 1, 1)).toISOString();
    const { count: usedCount } = await admin.from("product_events").select("id", { count: "exact", head: true })
      .eq("user_id", me).eq("event", "recap_generated").gte("created_at", monthStart.toISOString());
    const used = usedCount ?? 0;
    const usage = (n: number) => ({ used: n, limit: FREE_RECAPS_PER_MONTH, over: n > FREE_RECAPS_PER_MONTH, enforced: ENFORCE_LIMIT, resets });
    if (body.usage_only) return json({ usage: usage(used) });

    // Updating a team recap: the same practice and video, from the same start through now.
    // deno-lint-ignore no-explicit-any
    let base: any = null;
    if (body.update_of) {
      ({ data: base } = await asUser.from("recaps").select("id, project_id, team, cycle, period, period_start, video_id").eq("id", body.update_of).maybeSingle());
      if (!base?.team) return json({ error: "This recap isn’t available." }, 404);
    }
    const project_id = base?.project_id ?? body.project_id;
    const video_id: string | null = base ? base.video_id : (body.video_id ?? null);
    const scope = base || body.scope === "project" ? "project" : "me";
    const team = scope === "project";
    const period = base?.period ?? (["last", "week", "month", "custom"].includes(body.period ?? "") ? body.period! : "week");
    // "Share without private feedback": the same recap made again from team-visible notes only, so it can be shared.
    const excludePrivate = body.exclude_private === true;
    if (!project_id) return json({ error: "Pick a project." }, 400);

    // Membership check through RLS: non-members simply don't see the project.
    const { data: project } = await asUser.from("projects").select("id, title, is_sample").eq("id", project_id).maybeSingle();
    if (!project) return json({ error: "Project not found." }, 404);

    // ---------- Period ----------
    const now = new Date();
    let start: Date;
    let end = now;
    if (base) {
      start = new Date(base.period_start);
    } else if (body.range?.from && body.range?.to) {
      // Exactly the window of an earlier recap (used when remaking one without private notes).
      start = new Date(body.range.from);
      end = new Date(body.range.to);
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return json({ error: "Pick a valid date range." }, 400);
    } else if (period === "custom") {
      start = new Date(body.from ?? "");
      end = body.to ? new Date(new Date(body.to).getTime() + DAY - 1) : now;
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return json({ error: "Pick a valid date range." }, 400);
    } else if (period === "last") {
      // The last rehearsal = the day of the most recent upload, through now.
      const { data: lastTake } = await asUser.from("takes").select("created_at").eq("project_id", project_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      start = lastTake ? new Date(lastTake.created_at) : new Date(now.getTime() - 7 * DAY);
      start.setUTCHours(0, 0, 0, 0);
    } else {
      start = new Date(now.getTime() - (period === "week" ? 7 : 30) * DAY);
    }
    // A team recap made by hand belongs to the practice it starts on, so the whole team lands on the same one.
    const cycle: string | null = !team ? null : base ? base.cycle
      : period === "custom" ? `custom:${start.toISOString().slice(0, 10)}:${end.toISOString().slice(0, 10)}` : `${period}:${start.toISOString().slice(0, 10)}`;

    // ---------- Notes the caller can see ----------
    let q = asUser.from("notes")
      .select(`${NOTE_COLUMNS}, takes(number, uploaded_by), videos(title, created_by), note_mentions(user_id)`)
      .eq("project_id", project_id)
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString())
      .order("created_at", { ascending: true })
      .limit(MAX_NOTES);
    if (video_id) q = q.eq("video_id", video_id);
    const { data: rawNotes, error: notesErr } = await q;
    if (notesErr) return json({ error: notesErr.message }, 500);
    let notes = (rawNotes ?? []) as Note[];
    // Private notes (coach → one student) never go into a project recap; a personal recap may use them but can't be shared.
    if (team) notes = notes.filter((n) => !n.private_to);
    if (scope === "me") {
      notes = notes.filter((n) =>
        n.author_id === me || n.private_to === me || n.takes?.uploaded_by === me || n.videos?.created_by === me ||
        (n.note_mentions ?? []).some((m: { user_id: string }) => m.user_id === me));
    }
    if (excludePrivate) notes = notes.filter((n) => !n.private_to);
    if (!notes.length) {
      return json({ empty: true, message: excludePrivate ? "Without the private notes, there’s nothing left to summarize for this period." : "No notes in this period yet." });
    }
    const notesUpTo = upTo(notes);

    // ---------- Same inputs as an existing recap? Return it instead of spending a generation. ----------
    // A team recap is the team's: anyone's matches, in any language (the app offers a translation).
    let existingQ = admin.from("recaps").select("*").eq("project_id", project_id).eq("note_count", notes.length).gte("notes_up_to", notesUpTo)
      .order("created_at", { ascending: false }).limit(1);
    existingQ = video_id ? existingQ.eq("video_id", video_id) : existingQ.is("video_id", null);
    if (team) existingQ = existingQ.eq("team", true).eq("cycle", cycle!);
    else {
      existingQ = existingQ.eq("created_by", me).eq("team", false).eq("scope", scope).eq("period", period).eq("content->>lang", lang);
      if (period === "custom" || body.range) existingQ = existingQ.eq("period_start", start.toISOString());
      if (excludePrivate) existingQ = existingQ.eq("has_private", false);
    }
    const { data: existing } = await existingQ.maybeSingle();
    if (existing) return json({ recap: existing, cached: true, usage: usage(used) });

    if (!project.is_sample) {
      const { count: today } = await admin.from("product_events").select("id", { count: "exact", head: true })
        .eq("user_id", me).eq("event", "recap_generated").gte("created_at", new Date(Date.now() - DAY).toISOString());
      if ((today ?? 0) >= DAILY_SAFETY_CAP) return json({ error: "That’s a lot of recaps for one day. Try again tomorrow." }, 429);
    }
    if (!project.is_sample && ENFORCE_LIMIT && used >= FREE_RECAPS_PER_MONTH) {
      return json({ error: `You’ve used this month’s ${FREE_RECAPS_PER_MONTH} free AI recaps. They reset on the 1st, or the Team plan makes them unlimited.`, usage: usage(used) }, 402);
    }

    const b = await build({ notes, db: asUser, scope, projectTitle: project.title, me, lang, start, end });
    const { data: saved, error: saveErr } = await admin.from("recaps").insert({
      project_id, created_by: me, scope, period: base ? "custom" : period,
      period_start: start.toISOString(), period_end: end.toISOString(), video_id,
      team, auto: false, cycle, ...b,
    }).select("*").single();
    if (saveErr?.code === "23505") {
      // Someone on the team made the same update a moment ago: that one is the recap.
      const { data: same } = await existingQ.maybeSingle();
      if (same) return json({ recap: same, cached: true, usage: usage(used) });
    }
    if (saveErr) return json({ error: saveErr.message }, 500);
    if (project.is_sample) return json({ recap: saved });
    await admin.from("product_events").insert({ user_id: me, event: "recap_generated", props: { project_id, scope, team, update: !!base } });
    return json({ recap: saved, usage: usage(used + 1) });
  } catch (err) {
    if (err instanceof Fail) return json({ error: err.message }, err.status);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
});
