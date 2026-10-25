// generate-recap: turns the notes someone can see into a short AI recap, then saves it.
// Notes are read with the caller's own token, so row level security decides what goes in.
// Every recap item must cite notes from the input; anything citing an unknown note is dropped.
import Anthropic from "npm:@anthropic-ai/sdk@0.132.1";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const MODEL = "claude-opus-5-5";
const MAX_NOTES = 400;
const DAY = 86_400_000;

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Your session ended. Log in again." }, 401);
  const me = userData.user.id;

  let body: { project_id?: string; scope?: string; period?: string; from?: string; to?: string; video_id?: string | null };
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  const { project_id, video_id = null } = body;
  const scope = body.scope === "project" ? "project" : "me";
  const period = ["last", "week", "month", "custom"].includes(body.period ?? "") ? body.period! : "week";
  if (!project_id) return json({ error: "Pick a project." }, 400);

  // Membership check through RLS: non-members simply don't see the project.
  const { data: project } = await asUser.from("projects").select("id, title").eq("id", project_id).maybeSingle();
  if (!project) return json({ error: "Project not found." }, 404);

  // ---------- Period ----------
  const now = new Date();
  let start: Date;
  let end = now;
  if (period === "custom") {
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

  // ---------- Notes the caller can see ----------
  let q = asUser.from("notes")
    .select("id, body, status, t_start, t_end, author_id, created_at, updated_at, video_id, take_id, takes(number, uploaded_by), videos(title, created_by), note_reactions(user_id), note_mentions(user_id)")
    .eq("project_id", project_id)
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString())
    .order("created_at", { ascending: true })
    .limit(MAX_NOTES);
  if (video_id) q = q.eq("video_id", video_id);
  const { data: rawNotes, error: notesErr } = await q;
  if (notesErr) return json({ error: notesErr.message }, 500);
  // deno-lint-ignore no-explicit-any
  let notes = (rawNotes ?? []) as any[];
  if (scope === "me") {
    notes = notes.filter((n) =>
      n.author_id === me || n.takes?.uploaded_by === me || n.videos?.created_by === me ||
      (n.note_mentions ?? []).some((m: { user_id: string }) => m.user_id === me));
  }
  if (!notes.length) return json({ empty: true, message: "No notes in this period yet." });

  const notesUpTo = notes.reduce((max, n) => (n.updated_at > max ? n.updated_at : max), notes[0].updated_at);

  // ---------- Same inputs as an existing recap? Return it instead of spending a generation. ----------
  let existingQ = admin.from("recaps").select("*").eq("created_by", me).eq("project_id", project_id).eq("scope", scope).eq("period", period)
    .eq("note_count", notes.length).gte("notes_up_to", notesUpTo)
    .order("created_at", { ascending: false }).limit(1);
  existingQ = video_id ? existingQ.eq("video_id", video_id) : existingQ.is("video_id", null);
  if (period === "custom") existingQ = existingQ.eq("period_start", start.toISOString());
  const { data: existing } = await existingQ.maybeSingle();
  if (existing) return json({ recap: existing, cached: true });

  // ---------- Prompt ----------
  const ids = [...new Set(notes.map((n) => n.author_id))];
  const { data: profiles } = await asUser.from("profiles").select("id, display_name").in("id", ids);
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
    ? `Personal recap for ${nameOf[me] ?? "this dancer"}: notes they wrote, notes on their takes or videos, and notes that @mention them. Address them as "you".`
    : `Whole-project recap for everyone on "${project.title}". Address the team.`;
  const user = `${audience}\nPeriod: ${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}.\n\nNotes (${sources.length}):\n\n${lines.join("\n\n")}`;

  // ---------- Generate ----------
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "AI recaps aren’t switched on yet. The project owner needs to add the AI key in Supabase." }, 503);
  const client = new Anthropic({ apiKey });
  // deno-lint-ignore no-explicit-any
  let response: any;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      // On a safety decline, Anthropic re-runs the request on its recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // deno-lint-ignore no-explicit-any
    } as any);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: "The AI is busy. Try again in a minute." }, 429);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "The AI key isn’t valid. Ask the project owner to check it." }, 503);
    if (err instanceof Anthropic.APIError) return json({ error: `The AI couldn’t write this recap (${err.status}). Try again.` }, 502);
    return json({ error: "Couldn’t reach the AI. Try again." }, 502);
  }
  if (response.stop_reason === "refusal") return json({ error: "The AI couldn’t write a recap for these notes." }, 422);
  if (response.stop_reason === "max_tokens") return json({ error: "The recap ran too long. Try a shorter period." }, 422);
  const text = response.content.find((b: { type: string }) => b.type === "text")?.text;
  // deno-lint-ignore no-explicit-any
  let parsed: any;
  try { parsed = JSON.parse(text ?? ""); } catch { return json({ error: "The AI returned something unreadable. Try again." }, 502); }

  // ---------- Grounding: keep only items whose citations are real notes from the input ----------
  const known = new Set(sources.map((s) => s.ref));
  const content: Record<string, unknown> = { headline: String(parsed.headline ?? "").slice(0, 300) };
  for (const key of SECTIONS) {
    content[key] = (Array.isArray(parsed[key]) ? parsed[key] : [])
      .filter((it: { text?: string; cites?: string[] }) => it?.text && Array.isArray(it.cites) && it.cites.length && it.cites.every((c) => known.has(c)))
      .map((it: { text: string; cites: string[] }) => ({ text: it.text.slice(0, 400), cites: [...new Set(it.cites)] }));
  }
  const cited = new Set(SECTIONS.flatMap((k) => (content[k] as { cites: string[] }[]).flatMap((it) => it.cites)));

  const { data: saved, error: saveErr } = await admin.from("recaps").insert({
    project_id,
    created_by: me,
    scope,
    period,
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    video_id,
    notes_up_to: notesUpTo,
    note_count: notes.length,
    content,
    sources: sources.filter((s) => cited.has(s.ref)),
    model: response.model ?? MODEL,
  }).select("*").single();
  if (saveErr) return json({ error: saveErr.message }, 500);
  return json({ recap: saved });
});
