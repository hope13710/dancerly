// send-emails: follows up on Inbox notifications by email. Called every 5 minutes by pg_cron (migration 025).
//   instant  mentions, private notes, replies, video requests: ~15 min after, bundled per person, skipped if read
//   digest   everything else, once a morning at 8 AM US Eastern, only when there is something
//   weekly   Monday 8 AM Eastern: fixes and takes from the past week, only after an active week
//   start    getting started, at most once each: a nudge when a new leader has no video after 2 days
//            (10 AM their time), and a note when the first teammate joins (replaces that "joined" email)
// Also serves the one-click unsubscribe links (GET from the email footer, POST from mail apps).
// Private note text never goes into an email. No open-tracking pixels; links carry ?ref=email_<kind>.
// Secrets: RESEND_API_KEY. Without it, nothing is sent and nothing is marked.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SITE = "https://dancerly.app";
const FROM_ADDRESS = "notifications@dancerly.app";
const REPLY_TO = "help@dancerly.app";
const DIGEST_ZONE = "America/New_York";
const DIGEST_HOUR = 8;
const INSTANT_DELAY_MIN = 15;
const QUIET_FROM = 22; // no instant emails 10 PM–7 AM in the person's own time zone
const QUIET_TO = 7;

// Notification kind -> settings group, and each group's default.
const GROUP: Record<string, string> = {
  mention: "mention", private_note: "private_note", reply: "reply",
  request_new: "request", request_reminder: "request", request_due: "request",
  note_on_your_video: "note_on_your_video", new_take: "new_take", note_resolved: "note_resolved",
  joined: "joined", recap_shared: "recap_shared",
};
const DEFAULTS: Record<string, string> = {
  mention: "instant", private_note: "instant", reply: "instant", request: "instant",
  note_on_your_video: "digest", new_take: "digest", note_resolved: "digest", joined: "digest", recap_shared: "digest",
};
const GROUP_LABEL: Record<string, string> = {
  mention: "@mention emails", private_note: "private note emails", reply: "reply emails", request: "video request emails",
  note_on_your_video: "emails about notes on your videos", new_take: "new take emails", note_resolved: "emails about fixed notes",
  joined: "emails about people joining", recap_shared: "recap emails", digest: "morning summary emails", weekly: "weekly progress emails",
  onboarding: "getting started emails",
};
const NUDGE_HOUR = 10;
const isPersona = (id: string) => id.startsWith("5a3b0000-");

const url = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// ---------- helpers ----------
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const first = (name?: string | null) => (name ?? "Someone").split(" ")[0];
const clip = (s: string, n = 180) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const hourIn = (zone: string, d = new Date()) => {
  try { return Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" }).format(d)); }
  catch { return Number(new Intl.DateTimeFormat("en-US", { timeZone: DIGEST_ZONE, hour: "numeric", hourCycle: "h23" }).format(d)); }
};
const dayIn = (zone: string, d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const weekdayIn = (zone: string, d = new Date()) => new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" }).format(d);
const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - y.getTime()) / 864e5 + 1) / 7)).padStart(2, "0")}`;
};
const dueLabel = (iso?: string | null) => iso ? new Date(iso).toLocaleString("en-US", { timeZone: DIGEST_ZONE, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" : "";

async function secret(): Promise<string> {
  const { data } = await admin.rpc("email_cron_secret");
  return String(data ?? "");
}
async function sign(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
  return [...sig].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// dancerly.app/email/unsubscribe is proxied here by Vercel, so the link people see is on our own domain.
const unsubUrl = async (key: string, user: string, group: string) =>
  `${SITE}/email/unsubscribe?u=${user}&g=${group}&t=${await sign(key, `${user}:${group}`)}`;

// ---------- the email itself ----------
function layout({ heading, body, cta, ctaHref, footer }: { heading: string; body: string; cta?: string; ctaHref?: string; footer: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;color:#15161a">
<div style="max-width:520px;margin:0 auto;padding:28px 16px">
<p style="margin:0 0 18px;font-weight:800;font-size:18px;letter-spacing:-0.02em;color:#5b5ce2">dancerly</p>
<div style="background:#fff;border-radius:14px;padding:24px 22px;border:1px solid #e7e8ee">
<h1 style="margin:0 0 14px;font-size:19px;line-height:1.35;letter-spacing:-0.01em">${heading}</h1>
${body}
${cta ? `<p style="margin:22px 0 2px"><a href="${ctaHref}" style="display:inline-block;background:#15161a;color:#fff;text-decoration:none;font-weight:650;font-size:14px;padding:11px 18px;border-radius:10px">${esc(cta)}</a></p>` : ""}
</div>
<p style="margin:16px 4px 0;font-size:12px;line-height:1.6;color:#80869a">${footer}</p>
</div></body></html>`;
}
const quote = (text: string) => `<p style="margin:10px 0 0;padding:10px 12px;border-left:3px solid #5b5ce2;background:#f6f6ff;border-radius:6px;font-size:14px;line-height:1.5;color:#2b2d36">${esc(clip(text))}</p>`;
const itemRow = (line: string, href: string, extra = "") => `<div style="padding:12px 0;border-top:1px solid #eef0f4"><a href="${href}" style="color:#15161a;text-decoration:none;font-size:14px;line-height:1.5">${line}</a>${extra}</div>`;

type Ctx = {
  names: Map<string, string>; notes: Map<string, any>; takes: Map<string, any>; videos: Map<string, any>;
  projects: Map<string, any>; requests: Map<string, any>; recaps: Map<string, any>;
};

// One notification -> { subject line, html line, link, quoted text }.
function describe(n: any, c: Ctx) {
  const who = first(c.names.get(n.actor_id));
  const note = n.note_id ? c.notes.get(n.note_id) : null;
  const take = c.takes.get(n.take_id ?? note?.take_id);
  const video = c.videos.get(take?.video_id ?? note?.video_id);
  const project = c.projects.get(n.project_id);
  const at = note ? fmt(Number(note.t_start)) : "";
  const vtitle = video?.title ?? "a video";
  const ref = `ref=email_${GROUP[n.kind] ?? n.kind}`;
  const noteHref = note && video ? `${SITE}/app/p/${n.project_id}/v/${video.id}?take=${take?.number ?? ""}&note=${note.id}&${ref}` : `${SITE}/app/p/${n.project_id}?${ref}`;
  const showText = note && !note.private_to; // private notes stay in the app
  const req = n.request_id ? c.requests.get(n.request_id) : null;
  const reqHref = req ? `${SITE}/app/p/${n.project_id}/requests/${req.id}?${ref}` : `${SITE}/app?${ref}`;
  switch (n.kind) {
    case "mention": return { subject: `${who} mentioned you on “${vtitle}”`, line: `<b>${esc(who)}</b> mentioned you on <b>${esc(vtitle)}</b> at ${at}`, href: noteHref, cta: `Open at ${at}`, text: showText ? note.body : null };
    case "private_note": return { subject: `${who} sent you a private note`, line: `<b>${esc(who)}</b> sent you a private note on <b>${esc(vtitle)}</b>. Only the two of you can see it.`, href: noteHref, cta: "Open in dancerly", text: null };
    case "reply": return { subject: `${who} replied on “${vtitle}”`, line: `<b>${esc(who)}</b> replied to a note on <b>${esc(vtitle)}</b> at ${at}`, href: noteHref, cta: "See the reply", text: showText ? note.body : null };
    case "note_on_your_video": return { subject: `${who} left a note on “${vtitle}”`, line: `<b>${esc(who)}</b> left a note on <b>${esc(vtitle)}</b> at ${at}`, href: noteHref, cta: `Open at ${at}`, text: showText ? note.body : null };
    case "new_take": return { subject: `${who} uploaded Take ${take?.number ?? ""} of “${vtitle}”`, line: `<b>${esc(who)}</b> uploaded Take ${take?.number ?? ""} of <b>${esc(vtitle)}</b>`, href: video ? `${SITE}/app/p/${n.project_id}/v/${video.id}?take=${take?.number ?? ""}&${ref}` : `${SITE}/app?${ref}`, cta: "Watch it", text: null };
    case "note_resolved": return { subject: `${who} fixed your note on “${vtitle}”`, line: `✓ <b>${esc(who)}</b> marked your note on <b>${esc(vtitle)}</b> at ${at} as fixed`, href: noteHref, cta: "See it", text: showText ? note.body : null };
    case "joined": return { subject: `${who} joined ${project?.title ?? "your project"}`, line: `<b>${esc(who)}</b> joined <b>${esc(project?.title ?? "your project")}</b>`, href: `${SITE}/app/p/${n.project_id}/people?${ref}`, cta: "Say hi", text: null };
    case "recap_shared": { const r = c.recaps.get(n.recap_id); return { subject: `${who} shared a recap`, line: `<b>${esc(who)}</b> shared a recap: ${esc(r?.headline ?? "")}`, href: `${SITE}/app/recaps/${n.recap_id}?${ref}`, cta: "Read the recap", text: null }; }
    case "request_new": return { subject: `${who} asked you for a video${req?.due_at ? ` · due ${dueLabel(req.due_at)}` : ""}`, line: `<b>${esc(who)}</b> asked you for a video: <b>${esc(req?.title ?? "")}</b>${req?.due_at ? ` · due ${esc(dueLabel(req.due_at))}` : ""}`, href: reqHref, cta: "Upload your video", text: null };
    case "request_reminder": return { subject: `Reminder: ${req?.title ?? "your video"}`, line: `<b>${esc(who)}</b> sent a reminder: <b>${esc(req?.title ?? "")}</b>${req?.due_at ? ` · due ${esc(dueLabel(req.due_at))}` : ""}`, href: reqHref, cta: "Upload your video", text: null };
    case "request_due": return { subject: `Due tomorrow: ${req?.title ?? "your video"}`, line: `<b>${esc(req?.title ?? "A video request")}</b> is due ${esc(dueLabel(req?.due_at))}. You haven’t sent yours yet.`, href: reqHref, cta: "Upload your video", text: null };
    default: return { subject: "New activity on dancerly", line: "New activity on dancerly", href: `${SITE}/app/inbox?${ref}`, cta: "Open dancerly", text: null };
  }
}

async function loadContext(rows: any[]): Promise<Ctx> {
  const ids = (k: string) => [...new Set(rows.map((r) => r[k]).filter(Boolean))];
  const map = (data: any[] | null) => new Map((data ?? []).map((x) => [x.id, x]));
  const { data: notes } = ids("note_id").length ? await admin.from("notes").select("id, body, t_start, take_id, video_id, private_to").in("id", ids("note_id")) : { data: [] };
  const takeIds = [...new Set([...ids("take_id"), ...(notes ?? []).map((n: any) => n.take_id)])];
  const { data: takes } = takeIds.length ? await admin.from("takes").select("id, number, video_id").in("id", takeIds) : { data: [] };
  const videoIds = [...new Set([...(takes ?? []).map((t: any) => t.video_id), ...(notes ?? []).map((n: any) => n.video_id)])];
  const [{ data: videos }, { data: projects }, { data: requests }, { data: recaps }, { data: people }] = await Promise.all([
    videoIds.length ? admin.from("videos").select("id, title").in("id", videoIds) : { data: [] },
    ids("project_id").length ? admin.from("projects").select("id, title").in("id", ids("project_id")) : { data: [] },
    ids("request_id").length ? admin.from("requests").select("id, title, due_at").in("id", ids("request_id")) : { data: [] },
    ids("recap_id").length ? admin.from("recaps").select("id, content").in("id", ids("recap_id")) : { data: [] },
    ids("actor_id").length ? admin.from("profiles").select("id, display_name").in("id", ids("actor_id")) : { data: [] },
  ]);
  return {
    names: new Map((people ?? []).map((p: any) => [p.id, p.display_name])),
    notes: map(notes), takes: map(takes), videos: map(videos), projects: map(projects), requests: map(requests),
    recaps: new Map((recaps ?? []).map((r: any) => [r.id, { headline: r.content?.headline }])),
  };
}

async function emailOf(user: string) {
  const { data } = await admin.auth.admin.getUserById(user);
  const email = data?.user?.email ?? null;
  return email && !email.endsWith(".invalid") ? email : null; // sample teammates have made-up addresses
}

async function send(to: string, subject: string, html: string, text: string, fromName: string, unsubscribe: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${fromName} <${FROM_ADDRESS}>`, to: [to], reply_to: REPLY_TO, subject, html, text,
      headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    }),
  });
  if (!res.ok) console.error("resend", res.status, (await res.text()).slice(0, 300));
  await new Promise((r) => setTimeout(r, 600)); // stay under Resend's per-second limit
  return res.ok;
}

const footerFor = (why: string, unsub: string, label: string) =>
  `${why} · <a href="${unsub}" style="color:#80869a">Turn off ${esc(label)}</a> · <a href="${SITE}/app/settings/notifications" style="color:#80869a">Email settings</a><br>dancerly · Every dancer deserves to see their progress.`;

// ---------- instant + digest ----------
async function followUp(key: string) {
  const now = Date.now();
  const { data: rows } = await admin.from("notifications")
    .select("id, user_id, kind, actor_id, project_id, take_id, note_id, recap_id, request_id, created_at, read_at")
    .is("emailed_at", null).gte("created_at", new Date(now - 3 * 864e5).toISOString()).order("created_at").limit(1000);
  if (!rows?.length) return { instant: 0, digest: 0 };

  // Read in the app, too old to be useful by email, or anything in a sample project (its teammates aren't real
  // people, and practice there shouldn't land in anyone's inbox): done, no email.
  const projectIds = [...new Set(rows.map((r) => r.project_id))];
  const { data: samples } = await admin.from("projects").select("id").eq("is_sample", true).in("id", projectIds);
  const sampleIds = new Set((samples ?? []).map((p: any) => p.id));
  const done = rows.filter((r) => r.read_at || Date.parse(r.created_at) < now - 2 * 864e5 || sampleIds.has(r.project_id) || r.user_id.startsWith("5a3b0000-")).map((r) => r.id);
  if (done.length) await admin.from("notifications").update({ emailed_at: new Date().toISOString(), email_state: "skipped" }).in("id", done);
  const open = rows.filter((r) => !done.includes(r.id));
  if (!open.length) return { instant: 0, digest: 0 };

  const users = [...new Set(open.map((r) => r.user_id))];
  const { data: settings } = await admin.from("notification_settings").select("user_id, email, timezone").in("user_id", users);
  const prefs = new Map((settings ?? []).map((s: any) => [s.user_id, s]));
  const pref = (user: string, kind: string) => (prefs.get(user)?.email?.[GROUP[kind]] ?? DEFAULTS[GROUP[kind]] ?? "digest");

  const off = open.filter((r) => pref(r.user_id, r.kind) === "off").map((r) => r.id);
  if (off.length) await admin.from("notifications").update({ emailed_at: new Date().toISOString(), email_state: "skipped" }).in("id", off);

  const celebrated = await firstTeammate(key, open, prefs, off, now);

  const digestNow = hourIn(DIGEST_ZONE) === DIGEST_HOUR;
  const today = dayIn(DIGEST_ZONE);
  const ctx = await loadContext(open);
  let instant = 0, digest = 0;

  for (const user of users) {
    const mine = open.filter((r) => r.user_id === user && !off.includes(r.id) && !celebrated.has(r.id));
    const tz = prefs.get(user)?.timezone || DIGEST_ZONE;
    const h = hourIn(tz);
    const quiet = h >= QUIET_FROM || h < QUIET_TO;
    const ready = mine.filter((r) => pref(user, r.kind) === "instant" && Date.parse(r.created_at) <= now - INSTANT_DELAY_MIN * 60e3);
    const forDigest = mine.filter((r) => pref(user, r.kind) === "digest");
    const to = (ready.length && !quiet) || (forDigest.length && digestNow) ? await emailOf(user) : null;
    if (!to) continue;

    // Instant: one email per person per run, everything that's waiting.
    if (ready.length && !quiet) {
      const items = ready.map((r) => ({ r, d: describe(r, ctx) }));
      const lead = items[0].d;
      const actors = new Set(ready.map((r) => r.actor_id));
      const subject = items.length === 1 ? lead.subject : `${lead.subject} · ${items.length - 1} more`;
      const unsub = await unsubUrl(key, user, GROUP[ready[0].kind]);
      const body = items.length === 1
        ? `<p style="margin:0;font-size:15px;line-height:1.55">${lead.line}</p>${lead.text ? quote(lead.text) : ""}`
        : items.map(({ d }) => itemRow(d.line, d.href, d.text ? quote(d.text) : "")).join("");
      const html = layout({ heading: items.length === 1 ? esc(lead.subject) : "Waiting for you on dancerly", body, cta: items.length === 1 ? lead.cta : "Open dancerly", ctaHref: items.length === 1 ? lead.href : `${SITE}/app/inbox?ref=email_instant`, footer: footerFor("You got this because it was for you on dancerly", unsub, GROUP_LABEL[GROUP[ready[0].kind]]) });
      const text = `${items.map(({ d }) => `${d.line.replace(/<[^>]+>/g, "")}${d.text ? `\n“${clip(d.text)}”` : ""}\n${d.href}`).join("\n\n")}\n\nTurn off: ${unsub}`;
      const fromName = actors.size === 1 ? `${first(ctx.names.get(ready[0].actor_id))} via dancerly` : "dancerly";
      if (await send(to, subject, html, text, fromName, unsub)) {
        await admin.from("notifications").update({ emailed_at: new Date().toISOString(), email_state: "sent" }).in("id", ready.map((r) => r.id));
        instant++;
      }
    }

    // Digest: once a morning.
    if (forDigest.length && digestNow) {
      const { error: dup } = await admin.from("email_log").insert({ user_id: user, kind: "digest", period: today });
      if (dup) continue; // already sent today
      const items = forDigest.map((r) => ({ r, d: describe(r, ctx) }));
      // Fixes first: the best news leads.
      items.sort((a, b) => Number(b.r.kind === "note_resolved") - Number(a.r.kind === "note_resolved"));
      const count = (k: string[]) => forDigest.filter((r) => k.includes(r.kind)).length;
      const parts = [
        [count(["note_resolved"]), "fixed"], [count(["note_on_your_video"]), "new note"], [count(["new_take"]), "new take"],
        [count(["recap_shared"]), "recap"], [count(["joined"]), "new teammate"],
      ].filter(([n]) => (n as number) > 0).map(([n, w]) => w === "fixed" ? `${n} of your notes fixed` : `${n} ${w}${(n as number) > 1 ? "s" : ""}`);
      const unsub = await unsubUrl(key, user, "digest");
      const subject = `Your dancerly morning: ${parts.slice(0, 3).join(", ")}`;
      const html = layout({ heading: "Your dancerly morning", body: items.slice(0, 12).map(({ d }) => itemRow(d.line, d.href, d.text ? quote(d.text) : "")).join("") + (items.length > 12 ? `<p style="margin:10px 0 0;font-size:13px;color:#80869a">+ ${items.length - 12} more in your Inbox</p>` : ""), cta: "Open dancerly", ctaHref: `${SITE}/app?ref=email_digest`, footer: footerFor("Your daily summary of what happened in your projects", unsub, GROUP_LABEL.digest) });
      const text = `Your dancerly morning\n\n${items.map(({ d }) => `${d.line.replace(/<[^>]+>/g, "")}\n${d.href}`).join("\n\n")}\n\nTurn off: ${unsub}`;
      if (await send(to, subject, html, text, "dancerly", unsub)) {
        await admin.from("notifications").update({ emailed_at: new Date().toISOString(), email_state: "sent" }).in("id", forDigest.map((r) => r.id));
        digest++;
      } else {
        await admin.from("email_log").delete().match({ user_id: user, kind: "digest", period: today });
      }
    }
  }
  return { instant, digest, first_teammate: celebrated.size };
}

// ---------- getting started ----------
// The first person to join any of your projects gets its own email instead of a line in the morning summary.
// Returns the notification ids it handled (sent, or held until morning) so the regular emails leave them alone.
// deno-lint-ignore no-explicit-any
async function firstTeammate(key: string, open: any[], prefs: Map<string, any>, off: string[], now: number) {
  const handled = new Set<string>();
  const joins = open.filter((r) => r.kind === "joined" && !off.includes(r.id) && !isPersona(r.actor_id ?? ""));
  if (!joins.length) return handled;
  const owners = [...new Set(joins.map((r) => r.user_id))].filter((u) => prefs.get(u)?.email?.onboarding !== false);
  if (!owners.length) return handled;
  const { data: logged } = await admin.from("email_log").select("user_id").eq("kind", "first_teammate").in("user_id", owners);
  const done = new Set((logged ?? []).map((l: any) => l.user_id));
  const { data: owned } = await admin.from("projects").select("id, title, created_by").eq("is_sample", false).in("created_by", owners);
  for (const owner of owners.filter((u) => !done.has(u))) {
    const join = joins.filter((r) => r.user_id === owner).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0];
    const mine = (owned ?? []).filter((p: any) => p.created_by === owner);
    const project = mine.find((p: any) => p.id === join.project_id);
    if (!project) continue; // joined a project someone else created
    // Anyone who joined your projects before this one means it isn't the first.
    const { data: earlier } = await admin.from("project_members").select("user_id").eq("role", "member")
      .in("project_id", mine.map((p: any) => p.id)).neq("user_id", join.actor_id).lt("joined_at", join.created_at).limit(20);
    if ((earlier ?? []).some((m: any) => !isPersona(m.user_id))) continue;
    handled.add(join.id);
    // Same timing as instant emails: a short pause, never at night.
    const h = hourIn(prefs.get(owner)?.timezone || DIGEST_ZONE);
    if (Date.parse(join.created_at) > now - INSTANT_DELAY_MIN * 60e3 || h >= QUIET_FROM || h < QUIET_TO) continue;
    const to = await emailOf(owner);
    if (!to) continue;
    const { error: dup } = await admin.from("email_log").insert({ user_id: owner, kind: "first_teammate", period: "once" });
    if (dup) continue;
    const [{ data: person }, { data: videos }] = await Promise.all([
      admin.from("profiles").select("display_name").eq("id", join.actor_id).maybeSingle(),
      admin.from("videos").select("id, title").eq("project_id", project.id).order("created_at", { ascending: false }).limit(1),
    ]);
    const who = first(person?.display_name);
    const video = videos?.[0];
    const href = video ? `${SITE}/app/p/${project.id}/v/${video.id}?ref=email_first_teammate` : `${SITE}/app/p/${project.id}?ref=email_first_teammate`;
    const next = video
      ? `Next: open <b>${esc(video.title)}</b>, pause on a moment you want ${esc(who)} to see, and @mention them in a note.`
      : `Next: upload a rehearsal video so ${esc(who)} has something to watch. A phone clip from your last practice is plenty.`;
    const unsub = await unsubUrl(key, owner, "onboarding");
    const subject = `${who} joined ${project.title}`;
    const body = `<p style="margin:0;font-size:15px;line-height:1.55"><b>${esc(who)}</b> just joined <b>${esc(project.title)}</b>. Your team isn’t rehearsing alone anymore.</p>
<p style="margin:12px 0 0;font-size:15px;line-height:1.55">${next}</p>`;
    const html = layout({ heading: `${esc(who)} joined your team`, body, cta: video ? "Leave the first note" : "Upload a video", ctaHref: href, footer: footerFor("A one-time email for your first teammate", unsub, GROUP_LABEL.onboarding) });
    const text = `${who} just joined ${project.title}. Your team isn't rehearsing alone anymore.\n\n${next.replace(/<[^>]+>/g, "")}\n${href}\n\nTurn off: ${unsub}`;
    if (await send(to, subject, html, text, "dancerly", unsub)) {
      await admin.from("notifications").update({ emailed_at: new Date().toISOString(), email_state: "sent" }).eq("id", join.id);
    } else {
      await admin.from("email_log").delete().match({ user_id: owner, kind: "first_teammate", period: "once" });
    }
  }
  return handled;
}

// Two days after signing up, a leader who hasn't uploaded anything gets one friendly nudge, at 10 AM their time.
// Leaders: people who didn't arrive through someone else's invite. Anyone with a video in a real project is skipped.
async function startNudge(key: string) {
  const now = Date.now();
  const { data: fresh } = await admin.from("profiles").select("id, display_name, created_at")
    .lte("created_at", new Date(now - 2 * 864e5).toISOString()).gte("created_at", new Date(now - 7 * 864e5).toISOString()).limit(500);
  const users = (fresh ?? []).filter((p: any) => !isPersona(p.id));
  if (!users.length) return 0;
  const ids = users.map((p: any) => p.id);
  const [{ data: settings }, { data: logged }, { data: members }, { data: takes }] = await Promise.all([
    admin.from("notification_settings").select("user_id, email, timezone").in("user_id", ids),
    admin.from("email_log").select("user_id").eq("kind", "start_nudge").in("user_id", ids),
    admin.from("project_members").select("user_id, role, project_id, projects(title, is_sample, created_at)").in("user_id", ids),
    admin.from("takes").select("uploaded_by, projects(is_sample)").in("uploaded_by", ids).limit(2000),
  ]);
  const prefs = new Map((settings ?? []).map((s: any) => [s.user_id, s]));
  const done = new Set((logged ?? []).map((l: any) => l.user_id));
  const uploaded = new Set((takes ?? []).filter((t: any) => !t.projects?.is_sample).map((t: any) => t.uploaded_by));
  let sent = 0;
  for (const p of users) {
    if (done.has(p.id) || uploaded.has(p.id) || prefs.get(p.id)?.email?.onboarding === false) continue;
    if (hourIn(prefs.get(p.id)?.timezone || DIGEST_ZONE) !== NUDGE_HOUR) continue;
    const mine = (members ?? []).filter((m: any) => m.user_id === p.id);
    if (mine.some((m: any) => m.role === "member" && !m.projects?.is_sample)) continue; // joined someone else's team
    const real = mine.filter((m: any) => m.role === "owner" && !m.projects?.is_sample)
      .sort((a: any, b: any) => Date.parse(b.projects?.created_at) - Date.parse(a.projects?.created_at))[0];
    // Someone else already uploaded to their project: the team is moving, no nudge needed.
    if (real) {
      const { count } = await admin.from("takes").select("id", { count: "exact", head: true }).eq("project_id", real.project_id);
      if (count) continue;
    }
    const sample = mine.find((m: any) => m.projects?.is_sample);
    const to = await emailOf(p.id);
    if (!to) continue;
    const { error: dup } = await admin.from("email_log").insert({ user_id: p.id, kind: "start_nudge", period: "once" });
    if (dup) continue;
    const name = first(p.display_name);
    const href = real ? `${SITE}/app/p/${real.project_id}?ref=email_start` : `${SITE}/app?ref=email_start`;
    const unsub = await unsubUrl(key, p.id, "onboarding");
    const subject = "Your team’s first video";
    const where = real ? ` to <b>${esc(real.projects.title)}</b>` : "";
    const body = `<p style="margin:0;font-size:15px;line-height:1.55">Hi ${esc(name)},</p>
<p style="margin:12px 0 0;font-size:15px;line-height:1.55">I built dancerly because practice videos usually end up buried in a group chat, and the same notes get repeated week after week.</p>
<p style="margin:12px 0 0;font-size:15px;line-height:1.55">The quickest way to see if it helps your team: upload one video${where}. A phone clip from your last practice is plenty. Then pause on one moment and leave a note.</p>
${sample ? `<p style="margin:12px 0 0;font-size:15px;line-height:1.55">Not ready to film? <a href="${SITE}/app/p/${sample.project_id}?ref=email_start" style="color:#5b5ce2">The sample project</a> shows how it works in a minute.</p>` : ""}
<p style="margin:12px 0 0;font-size:15px;line-height:1.55">Stuck on anything? Just reply. A real person reads every email.</p>`;
    const html = layout({ heading: "Your team’s first video", body, cta: "Upload a video", ctaHref: href, footer: footerFor("A one-time email to help you get started", unsub, GROUP_LABEL.onboarding) });
    const text = `Hi ${name},\n\nI built dancerly because practice videos usually end up buried in a group chat, and the same notes get repeated week after week.\n\nThe quickest way to see if it helps your team: upload one video${real ? ` to ${real.projects.title}` : ""}. A phone clip from your last practice is plenty. Then pause on one moment and leave a note.\n\n${href}\n\nStuck on anything? Just reply. A real person reads every email.\n\nTurn off: ${unsub}`;
    if (await send(to, subject, html, text, "dancerly", unsub)) sent++;
    else await admin.from("email_log").delete().match({ user_id: p.id, kind: "start_nudge", period: "once" });
  }
  return sent;
}

// ---------- weekly ----------
async function weekly(key: string) {
  if (weekdayIn(DIGEST_ZONE) !== "Mon" || hourIn(DIGEST_ZONE) !== DIGEST_HOUR) return 0;
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const week = isoWeek(new Date());
  const { data: real } = await admin.from("projects").select("id, title, created_by").eq("is_sample", false);
  const realIds = new Set((real ?? []).map((p: any) => p.id));
  const owned = new Map<string, any[]>();
  for (const p of real ?? []) owned.set(p.created_by, [...(owned.get(p.created_by) ?? []), p]);
  const [{ data: fixed }, { data: takes }] = await Promise.all([
    admin.from("notes").select("id, project_id, author_id, take_id, takes(uploaded_by)").eq("status", "resolved").gte("resolved_at", since).limit(5000),
    admin.from("takes").select("id, project_id, uploaded_by").gte("created_at", since).limit(5000),
  ]);
  const fx = (fixed ?? []).filter((n: any) => realIds.has(n.project_id));
  const tk = (takes ?? []).filter((t: any) => realIds.has(t.project_id));
  const people = new Set<string>([...fx.map((n: any) => n.takes?.uploaded_by), ...fx.map((n: any) => n.author_id), ...tk.map((t: any) => t.uploaded_by)].filter(Boolean));
  for (const [owner, ps] of owned) if (ps.some((p) => fx.some((n: any) => n.project_id === p.id) || tk.some((t: any) => t.project_id === p.id))) people.add(owner);
  if (!people.size) return 0;
  const { data: settings } = await admin.from("notification_settings").select("user_id, email").in("user_id", [...people]);
  const optedOut = new Set((settings ?? []).filter((s: any) => s.email?.weekly === false).map((s: any) => s.user_id));
  let sent = 0;
  for (const user of people) {
    if (optedOut.has(user)) continue;
    const myFixes = fx.filter((n: any) => n.takes?.uploaded_by === user).length;
    const myTakes = tk.filter((t: any) => t.uploaded_by === user).length;
    const notesThatLanded = fx.filter((n: any) => n.author_id === user).length;
    const team = (owned.get(user) ?? []).map((p) => ({ p, fixes: fx.filter((n: any) => n.project_id === p.id).length, takes: tk.filter((t: any) => t.project_id === p.id).length })).filter((x) => x.fixes || x.takes);
    if (!myFixes && !myTakes && !notesThatLanded && !team.length) continue;
    const { error: dup } = await admin.from("email_log").insert({ user_id: user, kind: "weekly", period: week });
    if (dup) continue;
    const to = await emailOf(user);
    if (!to) continue;
    const stat = (n: number, label: string) => `<td style="padding:10px 8px;text-align:center"><div style="font-size:26px;font-weight:800;letter-spacing:-0.02em">${n}</div><div style="font-size:12px;color:#80869a">${label}</div></td>`;
    const lead = myFixes ? `${myFixes} note${myFixes > 1 ? "s" : ""} fixed in your takes` : team.length ? `${team.reduce((s, x) => s + x.fixes, 0)} notes fixed across your team` : `${myTakes} take${myTakes > 1 ? "s" : ""} uploaded`;
    const unsub = await unsubUrl(key, user, "weekly");
    const body = `<p style="margin:0 0 6px;font-size:15px;line-height:1.55">Here’s what got better last week.</p>
<table role="presentation" style="width:100%;border-collapse:collapse;margin:8px 0"><tr>${stat(myFixes, "notes fixed in your takes")}${stat(myTakes, "takes you uploaded")}${stat(notesThatLanded, "of your notes landed")}</tr></table>
${team.map((x) => `<p style="margin:8px 0 0;font-size:14px;line-height:1.5"><b>${esc(x.p.title)}</b>: ${x.fixes} notes fixed, ${x.takes} new takes</p>`).join("")}`;
    const html = layout({ heading: `Your week: ${esc(lead)}`, body, cta: "See your progress", ctaHref: `${SITE}/app/insights?ref=email_weekly`, footer: footerFor("Your weekly progress on dancerly", unsub, GROUP_LABEL.weekly) });
    const text = `Your week: ${lead}\nNotes fixed in your takes: ${myFixes}\nTakes you uploaded: ${myTakes}\nYour notes that landed: ${notesThatLanded}\n${team.map((x) => `${x.p.title}: ${x.fixes} notes fixed, ${x.takes} new takes`).join("\n")}\n\n${SITE}/app/insights\n\nTurn off: ${unsub}`;
    if (await send(to, `Your week: ${lead}`, html, text, "dancerly", unsub)) sent++;
    else await admin.from("email_log").delete().match({ user_id: user, kind: "weekly", period: week });
  }
  return sent;
}

// ---------- unsubscribe ----------
// Edge Functions can't serve HTML pages, so a click lands back on dancerly.app/unsubscribed.html.
async function unsubscribe(req: Request, key: string) {
  const q = new URL(req.url).searchParams;
  const user = q.get("u") ?? "", group = q.get("g") ?? "", token = q.get("t") ?? "";
  const valid = /^[0-9a-f-]{36}$/.test(user) && GROUP_LABEL[group] !== undefined && token === (await sign(key, `${user}:${group}`));
  const done = (ok: boolean) => req.method === "POST"
    ? new Response(ok ? "ok" : "invalid", { status: ok ? 200 : 400 })
    : Response.redirect(`${SITE}/unsubscribed.html?${ok ? `g=${group}` : "invalid=1"}`, 302);
  if (!valid) return done(false);
  const { data: row } = await admin.from("notification_settings").select("email").eq("user_id", user).maybeSingle();
  const email = { ...(row?.email ?? {}) };
  if (group === "digest") for (const [g, d] of Object.entries(DEFAULTS)) { if ((email[g] ?? d) === "digest") email[g] = "off"; }
  else if (group === "weekly" || group === "onboarding") email[group] = false;
  else email[group] = "off";
  await admin.from("notification_settings").upsert({ user_id: user, email, updated_at: new Date().toISOString() });
  return done(true);
}

Deno.serve(async (req) => {
  const key = await secret();
  if (!key) return new Response("not ready", { status: 503 });
  if (new URL(req.url).searchParams.has("u")) return unsubscribe(req, key); // GET from the footer, POST one-click from mail apps
  if (req.headers.get("x-cron-secret") !== key) return new Response("forbidden", { status: 403 });
  if (!Deno.env.get("RESEND_API_KEY")) return Response.json({ skipped: "RESEND_API_KEY is not set" });
  const result = await followUp(key);
  const weeklySent = await weekly(key);
  const nudged = await startNudge(key);
  return Response.json({ ...result, weekly: weeklySent, start_nudge: nudged });
});
