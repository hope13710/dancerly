// send-emails: follows up on Inbox notifications by email. Called every 5 minutes by pg_cron (migration 025).
//   instant  mentions, private notes, replies, video requests: ~15 min after, bundled per person, skipped if read
//   digest   everything else, once a morning at 8 AM in each person's own time zone, only when there is something
//   weekly   Monday 8 AM in each person's own time zone: fixes and takes from the past week, plus the team's latest recap
//            (migration 049), only after an active week; a week with
//            uploads but no fixes yet gets one next step (invite, or leave the first note) instead of zeros
//   welcome  once, ~10 min after signing up (not at night): how dancerly works and one first step; people who
//            joined through an invite get the member version, about the team they joined
//   start    getting started, at most once each: a nudge when a new leader has no video after 2 days
//            (10 AM their time), a note when the first teammate joins (replaces that "joined" email), and an
//            "invite your team" email the day after a leader uploads while still alone in the project
// Also serves the one-click unsubscribe links (GET from the email footer, POST from mail apps).
// Private note text never goes into an email. No open-tracking pixels; links carry ?ref=email_<kind>.
// Secrets: RESEND_API_KEY. Without it, nothing is sent and nothing is marked.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SITE = "https://dancerly.app";
const FROM_ADDRESS = "notifications@dancerly.app";
const REPLY_TO = "help@dancerly.app";
const DIGEST_ZONE = "America/New_York"; // fallback for anyone whose time zone the app hasn't saved yet
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
  join_request: "join_request", join_approved: "join_request",
  added_to_project: "added",
};
const DEFAULTS: Record<string, string> = {
  mention: "instant", private_note: "instant", reply: "instant", request: "instant",
  note_on_your_video: "digest", new_take: "digest", note_resolved: "digest", joined: "digest", recap_shared: "digest",
  join_request: "instant", added: "instant",
};
const GROUP_LABEL: Record<string, string> = {
  mention: "@mention emails", private_note: "private note emails", reply: "reply emails", request: "assignment emails",
  note_on_your_video: "emails about notes on your videos", new_take: "new take emails", note_resolved: "emails about fixed notes",
  joined: "emails about people joining", recap_shared: "recap emails", digest: "morning summary emails", weekly: "weekly progress emails",
  onboarding: "getting started emails", join_request: "join request emails", added: "emails when you’re added to a project",
};
const NUDGE_HOUR = 10;
const WELCOME_DELAY_MIN = 10; // long enough to finish joining through an invite link
// Only people who sign up after the welcome email shipped; everyone before already knows dancerly.
const WELCOME_FROM = "2026-11-09T14:30:00Z";
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
// A due date in the reader's own time zone, e.g. "Tue, Nov 10, 7:00 PM GMT+9".
const dueLabel = (iso: string | null | undefined, zone: string) => {
  if (!iso) return "";
  const opts = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" } as const;
  try { return new Date(iso).toLocaleString("en-US", { ...opts, timeZone: zone }); }
  catch { return new Date(iso).toLocaleString("en-US", { ...opts, timeZone: DIGEST_ZONE }); }
};
// The ISO week of the reader's local date, so a Monday email in Auckland and one in Los Angeles share a period.
const localWeek = (zone: string) => { try { return isoWeek(new Date(`${dayIn(zone)}T12:00:00Z`)); } catch { return isoWeek(new Date()); } };

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
// The heading adds to the subject instead of repeating it (letters that open with "Hi ..." have none). The inbox
// preview line comes from the body, hidden at the top, padded so the footer doesn't leak into it.
function layout({ heading, body, cta, ctaHref, footer }: { heading?: string; body: string; cta?: string; ctaHref?: string; footer: string }) {
  const preview = (body || heading || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
  return `<!doctype html><html><body style="margin:0;background:#f4f5f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;color:#15161a">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preview}${"&#8199;&#65279;&#847; ".repeat(40)}</div>
<div style="max-width:520px;margin:0 auto;padding:28px 16px">
<a href="${SITE}" style="display:inline-block;margin:0 0 18px"><img src="${SITE}/logo-wordmark.png" alt="dancerly" width="102" height="24" style="display:block;height:24px;width:auto;border:0" /></a>
<div style="background:#fff;border-radius:14px;padding:24px 22px;border:1px solid #e7e8ee">
${heading ? `<h1 style="margin:0 0 14px;font-size:19px;line-height:1.35;letter-spacing:-0.01em">${heading}</h1>` : ""}
${body}
${cta ? `<p style="margin:22px 0 2px"><a href="${ctaHref}" style="display:inline-block;background:#5b5ce2;color:#fff;text-decoration:none;font-weight:650;font-size:14px;padding:11px 18px;border-radius:10px">${esc(cta)}</a></p>` : ""}
</div>
<p style="margin:16px 4px 0;font-size:12px;line-height:1.6;color:#80869a">${footer}</p>
</div></body></html>`;
}
const quote = (text: string) => `<p style="margin:10px 0 0;padding:10px 12px;border-left:3px solid #5b5ce2;background:#f6f6ff;border-radius:6px;font-size:14px;line-height:1.5;color:#2b2d36">${esc(clip(text))}</p>`;
const itemRow = (line: string, href: string, extra = "") => `<div style="padding:12px 0;border-top:1px solid #eef0f4"><a href="${href}" style="color:#15161a;text-decoration:none;font-size:14px;line-height:1.5">${line}</a>${extra}</div>`;

type Ctx = {
  names: Map<string, string>; notes: Map<string, any>; takes: Map<string, any>; videos: Map<string, any>;
  projects: Map<string, any>; requests: Map<string, any>; recaps: Map<string, any>; joins: Map<string, any>;
};

// One notification -> { subject line, html line, link, quoted text }.
function describe(n: any, c: Ctx, zone: string) {
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
    case "join_request": { const j = c.joins.get(n.join_request_id); return { subject: `${who} asked to join ${project?.title ?? "your project"}`, line: `<b>${esc(who)}</b> watched <b>${esc(vtitle)}</b> from your share link and asked to join <b>${esc(project?.title ?? "your project")}</b>${j?.t_start != null ? `. Their note at ${fmt(Number(j.t_start))}:` : "."}`, href: `${SITE}/app/p/${n.project_id}/people?${ref}`, cta: "Review the request", text: j?.body ?? null }; }
    case "added_to_project": return { subject: `${who} added you to ${project?.title ?? "a project"}`, line: `<b>${esc(who)}</b> added you to <b>${esc(project?.title ?? "a project")}</b>. You can see its videos and leave notes now.`, href: `${SITE}/app/p/${n.project_id}?${ref}`, cta: "Open the project", text: null };
    case "join_approved": return { subject: `You’re in: ${project?.title ?? "the project"}`, line: `<b>${esc(who)}</b> let you into <b>${esc(project?.title ?? "the project")}</b>${note ? `. Your note at ${at} is posted.` : "."}`, href: note ? noteHref : `${SITE}/app/p/${n.project_id}?${ref}`, cta: note ? "See your note" : "Open the project", text: null };
    case "recap_shared": { const r = c.recaps.get(n.recap_id); return { subject: `${who} shared a recap`, line: `<b>${esc(who)}</b> shared a recap: ${esc(r?.headline ?? "")}`, href: `${SITE}/app/recaps/${n.recap_id}?${ref}`, cta: "Read the recap", text: null }; }
    case "request_new": return { subject: `${who} gave you an assignment: ${req?.title ?? "a video"}${req?.due_at ? ` · due ${dueLabel(req.due_at, zone)}` : ""}`, line: `<b>${esc(who)}</b> gave you an assignment: <b>${esc(req?.title ?? "")}</b>${req?.due_at ? ` · due ${esc(dueLabel(req.due_at, zone))}` : ""}`, href: reqHref, cta: "Submit your video", text: null };
    case "request_reminder": return { subject: `Reminder: ${req?.title ?? "your assignment"}`, line: `<b>${esc(who)}</b> sent a reminder about your assignment: <b>${esc(req?.title ?? "")}</b>${req?.due_at ? ` · due ${esc(dueLabel(req.due_at, zone))}` : ""}`, href: reqHref, cta: "Submit your video", text: null };
    case "request_due": return { subject: `Due tomorrow: ${req?.title ?? "your assignment"}`, line: `Your assignment <b>${esc(req?.title ?? "")}</b> is due ${esc(dueLabel(req?.due_at, zone))}. You haven’t submitted yet.`, href: reqHref, cta: "Submit your video", text: null };
    default: return { subject: "New activity on dancerly", line: "New activity on dancerly", href: `${SITE}/app/inbox?${ref}`, cta: "Open dancerly", text: null };
  }
}

async function loadContext(rows: any[]): Promise<Ctx> {
  const ids = (k: string) => [...new Set(rows.map((r) => r[k]).filter(Boolean))];
  const map = (data: any[] | null) => new Map((data ?? []).map((x) => [x.id, x]));
  const { data: notes } = ids("note_id").length ? await admin.from("notes").select("id, body, t_start, take_id, video_id, private_to").in("id", ids("note_id")) : { data: [] };
  const takeIds = [...new Set([...ids("take_id"), ...(notes ?? []).map((n: any) => n.take_id)])];
  const { data: takes } = takeIds.length ? await admin.from("takes").select("id, number, video_id, deleted_at").in("id", takeIds) : { data: [] };
  const videoIds = [...new Set([...(takes ?? []).map((t: any) => t.video_id), ...(notes ?? []).map((n: any) => n.video_id)])];
  const [{ data: videos }, { data: projects }, { data: requests }, { data: recaps }, { data: people }] = await Promise.all([
    videoIds.length ? admin.from("videos").select("id, title, deleted_at").in("id", videoIds) : { data: [] },
    ids("project_id").length ? admin.from("projects").select("id, title").in("id", ids("project_id")) : { data: [] },
    ids("request_id").length ? admin.from("requests").select("id, title, due_at").in("id", ids("request_id")) : { data: [] },
    ids("recap_id").length ? admin.from("recaps").select("id, content").in("id", ids("recap_id")) : { data: [] },
    ids("actor_id").length ? admin.from("profiles").select("id, display_name").in("id", ids("actor_id")) : { data: [] },
  ]);
  const { data: joins } = ids("join_request_id").length ? await admin.from("join_requests").select("id, body, t_start").in("id", ids("join_request_id")) : { data: [] };
  return {
    names: new Map((people ?? []).map((p: any) => [p.id, p.display_name])),
    notes: map(notes), takes: map(takes), videos: map(videos), projects: map(projects), requests: map(requests),
    recaps: new Map((recaps ?? []).map((r: any) => [r.id, { headline: r.content?.headline }])),
    joins: map(joins),
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
    .select("id, user_id, kind, actor_id, project_id, take_id, note_id, recap_id, request_id, join_request_id, created_at, read_at")
    .is("emailed_at", null).gte("created_at", new Date(now - 3 * 864e5).toISOString()).order("created_at").limit(1000);
  if (!rows?.length) return { instant: 0, digest: 0 };

  // Read in the app, too old to be useful by email, or anything in a sample project (its teammates aren't real
  // people, and practice there shouldn't land in anyone's inbox): done, no email.
  const projectIds = [...new Set(rows.map((r) => r.project_id))];
  // Sample projects and projects in the Trash (migration 033) send nothing.
  const { data: samples } = await admin.from("projects").select("id").or("is_sample.eq.true,deleted_at.not.is.null").in("id", projectIds);
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

  const ctx = await loadContext(open);
  let instant = 0, digest = 0;

  // About a video or take that's now in the Trash: nothing to send.
  const trashed = open.filter((r) => {
    const take = ctx.takes.get(r.take_id ?? ctx.notes.get(r.note_id)?.take_id);
    const video = ctx.videos.get(take?.video_id ?? ctx.notes.get(r.note_id)?.video_id);
    return Boolean(take?.deleted_at || video?.deleted_at);
  }).map((r) => r.id);
  if (trashed.length) await admin.from("notifications").update({ emailed_at: new Date().toISOString(), email_state: "skipped" }).in("id", trashed);

  for (const user of users) {
    const mine = open.filter((r) => r.user_id === user && !off.includes(r.id) && !celebrated.has(r.id) && !trashed.includes(r.id));
    const tz = prefs.get(user)?.timezone || DIGEST_ZONE;
    const h = hourIn(tz);
    const quiet = h >= QUIET_FROM || h < QUIET_TO;
    // The morning summary goes out at 8 AM where they are; the period is their local date, so it's once a day for them.
    const digestNow = h === DIGEST_HOUR;
    const today = (() => { try { return dayIn(tz); } catch { return dayIn(DIGEST_ZONE); } })();
    const ready = mine.filter((r) => pref(user, r.kind) === "instant" && Date.parse(r.created_at) <= now - INSTANT_DELAY_MIN * 60e3);
    const forDigest = mine.filter((r) => pref(user, r.kind) === "digest");
    const to = (ready.length && !quiet) || (forDigest.length && digestNow) ? await emailOf(user) : null;
    if (!to) continue;

    // Instant: one email per person per run, everything that's waiting.
    if (ready.length && !quiet) {
      const items = ready.map((r) => ({ r, d: describe(r, ctx, tz) }));
      const lead = items[0].d;
      const actors = new Set(ready.map((r) => r.actor_id));
      const subject = items.length === 1 ? lead.subject : `${lead.subject} · ${items.length - 1} more`;
      const unsub = await unsubUrl(key, user, GROUP[ready[0].kind]);
      const body = items.length === 1
        ? (lead.text ? quote(lead.text) : "")
        : items.map(({ d }) => itemRow(d.line, d.href, d.text ? quote(d.text) : "")).join("");
      const html = layout({ heading: items.length === 1 ? lead.line.replace(/<\/?b>/g, "") : `${items.length} things waiting for you`, body, cta: items.length === 1 ? lead.cta : "Open dancerly", ctaHref: items.length === 1 ? lead.href : `${SITE}/app/inbox?ref=email_instant`, footer: footerFor("You got this because it was for you on dancerly", unsub, GROUP_LABEL[GROUP[ready[0].kind]]) });
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
      const items = forDigest.map((r) => ({ r, d: describe(r, ctx, tz) }));
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
  const { data: owned } = await admin.from("projects").select("id, title, created_by").eq("is_sample", false).is("deleted_at", null).in("created_by", owners);
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
    const unsub = await unsubUrl(key, owner, "onboarding");
    const { subject, html, text } = teammateEmail(first(person?.display_name), project, videos?.[0], unsub);
    if (await send(to, subject, html, text, "dancerly", unsub)) {
      await admin.from("notifications").update({ emailed_at: new Date().toISOString(), email_state: "sent" }).eq("id", join.id);
    } else {
      await admin.from("email_log").delete().match({ user_id: owner, kind: "first_teammate", period: "once" });
    }
  }
  return handled;
}

// deno-lint-ignore no-explicit-any
function teammateEmail(who: string, project: any, video: any, unsub: string) {
  const href = video ? `${SITE}/app/p/${project.id}/v/${video.id}?ref=email_first_teammate` : `${SITE}/app/p/${project.id}?ref=email_first_teammate`;
  const next = video
    ? `Next: open <b>${esc(video.title)}</b>, pause on a moment you want ${esc(who)} to see, and @mention them in a note.`
    : `Next: upload a practice video so ${esc(who)} has something to watch. A phone clip from your last practice is plenty.`;
  const body = `<p style="margin:0;font-size:15px;line-height:1.55"><b>${esc(who)}</b> just joined <b>${esc(project.title)}</b>.</p>
<p style="margin:12px 0 0;font-size:15px;line-height:1.55">${next}</p>`;
  return {
    subject: `${who} joined ${project.title}`,
    html: layout({ heading: "Your team isn’t practicing alone anymore", body, cta: video ? "Leave the first note" : "Upload a video", ctaHref: href, footer: footerFor("A one-time email for your first teammate", unsub, GROUP_LABEL.onboarding) }),
    text: `${who} just joined ${project.title}. Your team isn't practicing alone anymore.\n\n${next.replace(/<[^>]+>/g, "")}\n${href}\n\nTurn off: ${unsub}`,
  };
}

// Two versions: a leader with a project is one video away; one without a project is one step further back.
function nudgeEmail(name: string, real: { id: string; title: string } | null | undefined, sampleId: string | undefined, unsub: string) {
  const why = "I built dancerly because practice videos usually end up buried in a group chat, and the same notes get repeated week after week.";
  const help = "Stuck on anything? Just reply. A real person reads every email.";
  const sample = sampleId ? `Not ready yet? <a href="${SITE}/app/p/${sampleId}?ref=email_start" style="color:#5b5ce2">The sample project</a> shows how it works in a minute.` : "";
  const c = real
    ? {
      subject: "Your team’s first video", cta: "Upload a video", href: `${SITE}/app/p/${real.id}?ref=email_start`,
      step: `The quickest way to see if it helps your team: upload one video to <b>${esc(real.title)}</b>. A phone clip from your last practice is plenty. Then pause on one moment and leave a note.`,
    }
    : {
      subject: "Set up your team on dancerly", cta: "Create your team", href: `${SITE}/app?ref=email_start`,
      step: "Getting started takes about a minute: name your team, upload one video from your last practice, and invite your teammates with a link.",
    };
  const p = (t: string) => `<p style="margin:12px 0 0;font-size:15px;line-height:1.55">${t}</p>`;
  const body = `<p style="margin:0;font-size:15px;line-height:1.55">Hi ${esc(name)},</p>
${p(why)}
${p(c.step)}
${sample ? p(sample) : ""}
${p(help)}`;
  const plain = (t: string) => t.replace(/<[^>]+>/g, "");
  return {
    subject: c.subject,
    html: layout({ body, cta: c.cta, ctaHref: c.href, footer: footerFor("A one-time email to help you get started", unsub, GROUP_LABEL.onboarding) }),
    text: `Hi ${name},\n\n${why}\n\n${plain(c.step)}\n\n${c.href}\n\n${sample ? `${plain(sample)}\n\n` : ""}${help}\n\nTurn off: ${unsub}`,
  };
}

// Preview: sends the getting-started emails (both nudge versions) to one person, with their own project, marked [Test]. Logs nothing.
async function preview(key: string, user: string) {
  const to = await emailOf(user);
  if (!to) return { preview: "no email" };
  const [{ data: profile }, { data: members }] = await Promise.all([
    admin.from("profiles").select("display_name").eq("id", user).maybeSingle(),
    admin.from("project_members").select("project_id, role, projects(title, is_sample)").eq("user_id", user),
  ]);
  const real = (members ?? []).find((m: any) => m.role === "owner" && !m.projects?.is_sample);
  const sample = (members ?? []).find((m: any) => m.projects?.is_sample);
  const project = real ? { id: real.project_id, title: real.projects.title } : { id: "", title: "Your team" };
  const { data: videos } = real ? await admin.from("videos").select("id, title").eq("project_id", real.project_id).order("created_at", { ascending: false }).limit(1) : { data: [] };
  const unsub = await unsubUrl(key, user, "onboarding");
  const emails = [
    nudgeEmail(first(profile?.display_name), real && project, sample?.project_id, unsub),
    nudgeEmail(first(profile?.display_name), null, sample?.project_id, unsub),
    teammateEmail("Mina", project, videos?.[0], unsub),
    inviteEmail(first(profile?.display_name), project, videos?.[0]?.title ?? "your video", unsub),
    welcomeEmail(first(profile?.display_name), real ? { leader: { ...project, hasVideo: Boolean(videos?.length) } } : {}, unsub),
    welcomeEmail(first(profile?.display_name), { member: { project, by: "Mina" } }, unsub),
  ];
  const sent = [];
  for (const e of emails) sent.push(await send(to, `[Test] ${e.subject}`, e.html, e.text, "dancerly", unsub));
  return { preview: sent };
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
    admin.from("project_members").select("user_id, role, project_id, projects(title, is_sample, created_at, deleted_at)").in("user_id", ids),
    admin.from("takes").select("uploaded_by, projects(is_sample)").in("uploaded_by", ids).limit(2000),
  ]);
  const prefs = new Map((settings ?? []).map((s: any) => [s.user_id, s]));
  const done = new Set((logged ?? []).map((l: any) => l.user_id));
  const uploaded = new Set((takes ?? []).filter((t: any) => !t.projects?.is_sample).map((t: any) => t.uploaded_by));
  let sent = 0;
  for (const p of users) {
    if (done.has(p.id) || uploaded.has(p.id) || prefs.get(p.id)?.email?.onboarding === false) continue;
    if (hourIn(prefs.get(p.id)?.timezone || DIGEST_ZONE) !== NUDGE_HOUR) continue;
    const mine = (members ?? []).filter((m: any) => m.user_id === p.id && !m.projects?.deleted_at);
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
    const unsub = await unsubUrl(key, p.id, "onboarding");
    const { subject, html, text } = nudgeEmail(first(p.display_name), real && { id: real.project_id, title: real.projects.title }, sample?.project_id, unsub);
    if (await send(to, subject, html, text, "dancerly", unsub)) sent++;
    else await admin.from("email_log").delete().match({ user_id: p.id, kind: "start_nudge", period: "once" });
  }
  return sent;
}

// The day after a leader uploads while still alone in the project: one email asking them to send the invite link.
// Feedback only starts when someone else watches, so this is the step between "uploaded" and "my team uses it".
function inviteEmail(name: string, project: { id: string; title: string }, video: string, unsub: string) {
  const href = `${SITE}/app/p/${project.id}/people?invite=1&ref=email_invite`;
  const subject = `Invite your team to “${video}”`;
  const p = (t: string) => `<p style="margin:12px 0 0;font-size:15px;line-height:1.55">${t}</p>`;
  const lines = [
    `You uploaded <b>${esc(video)}</b> to <b>${esc(project.title)}</b>. Right now you’re the only one who can see it.`,
    "dancerly works once your team is in: they pause on the exact count and leave a note, you upload the next take, and you all see what got fixed.",
    "Inviting takes one link. Teammates join from their phone, with nothing to install.",
  ];
  const body = `<p style="margin:0;font-size:15px;line-height:1.55">Hi ${esc(name)},</p>\n${lines.map(p).join("\n")}`;
  const plain = (t: string) => t.replace(/<[^>]+>/g, "");
  return {
    subject,
    html: layout({ body, cta: "Invite your team", ctaHref: href, footer: footerFor("A one-time email to help you get started", unsub, GROUP_LABEL.onboarding) }),
    text: `Hi ${name},\n\n${lines.map(plain).join("\n\n")}\n\nInvite your team: ${href}\n\nTurn off: ${unsub}`,
  };
}

// Leaders whose project has a take at least a day old, an upload in the last 10 days, and still only them in it.
// Once per person, at 10 AM their time. Skipped while someone is asking to join (that has its own email).
async function inviteNudge(key: string) {
  const now = Date.now();
  const { data: recent } = await admin.from("takes").select("project_id, created_at, projects(title, created_by, is_sample, deleted_at)")
    .is("deleted_at", null).gte("created_at", new Date(now - 10 * 864e5).toISOString()).limit(5000);
  const projects = new Map<string, any>();
  for (const t of recent ?? []) {
    const pr = (t as any).projects;
    if (!pr || pr.is_sample || pr.deleted_at || isPersona(pr.created_by ?? "")) continue;
    const x = projects.get(t.project_id) ?? { id: t.project_id, title: pr.title, owner: pr.created_by, oldest: t.created_at };
    if (t.created_at < x.oldest) x.oldest = t.created_at;
    projects.set(t.project_id, x);
  }
  const ready = [...projects.values()].filter((x) => Date.parse(x.oldest) <= now - 20 * 36e5);
  if (!ready.length) return 0;
  const owners = [...new Set(ready.map((x) => x.owner))];
  const [{ data: roster }, { data: settings }, { data: logged }, { data: asks }] = await Promise.all([
    admin.from("project_members").select("project_id").in("project_id", ready.map((x) => x.id)),
    admin.from("notification_settings").select("user_id, email, timezone").in("user_id", owners),
    admin.from("email_log").select("user_id").eq("kind", "invite_nudge").in("user_id", owners),
    admin.from("join_requests").select("project_id").eq("status", "pending").in("project_id", ready.map((x) => x.id)),
  ]);
  const count = new Map<string, number>();
  for (const m of roster ?? []) count.set(m.project_id, (count.get(m.project_id) ?? 0) + 1);
  const asked = new Set((asks ?? []).map((a: any) => a.project_id));
  const prefs = new Map((settings ?? []).map((s: any) => [s.user_id, s]));
  const done = new Set((logged ?? []).map((l: any) => l.user_id));
  let sent = 0;
  for (const owner of owners) {
    if (done.has(owner) || prefs.get(owner)?.email?.onboarding === false) continue;
    if (hourIn(prefs.get(owner)?.timezone || DIGEST_ZONE) !== NUDGE_HOUR) continue;
    // Their newest solo project; if any of their projects already has a teammate, the team is there.
    const mine = ready.filter((x) => x.owner === owner);
    if (mine.some((x) => (count.get(x.id) ?? 1) > 1)) continue;
    const project = mine.filter((x) => !asked.has(x.id)).sort((a, b) => Date.parse(b.oldest) - Date.parse(a.oldest))[0];
    if (!project) continue;
    const [{ data: profile }, { data: videos }] = await Promise.all([
      admin.from("profiles").select("display_name").eq("id", owner).maybeSingle(),
      admin.from("videos").select("title").eq("project_id", project.id).is("deleted_at", null).order("created_at", { ascending: false }).limit(1),
    ]);
    if (!videos?.length) continue;
    const to = await emailOf(owner);
    if (!to) continue;
    const { error: dup } = await admin.from("email_log").insert({ user_id: owner, kind: "invite_nudge", period: "once" });
    if (dup) continue;
    const unsub = await unsubUrl(key, owner, "onboarding");
    const { subject, html, text } = inviteEmail(first(profile?.display_name), project, videos[0].title, unsub);
    if (await send(to, subject, html, text, "dancerly", unsub)) sent++;
    else await admin.from("email_log").delete().match({ user_id: owner, kind: "invite_nudge", period: "once" });
  }
  return sent;
}

// Welcome: what dancerly is for and the one next step. Leaders get the loop; invited members get their team.
function welcomeEmail(name: string, w: { member?: { project: { id: string; title: string }; by: string }; leader?: { id: string; title: string; hasVideo: boolean } }, unsub: string) {
  const p = (t: string) => `<p style="margin:12px 0 0;font-size:15px;line-height:1.55">${t}</p>`;
  const steps = (items: string[]) => `<ol style="margin:12px 0 0;padding-left:20px;font-size:15px;line-height:1.6">${items.map((t) => `<li style="margin:4px 0">${t}</li>`).join("")}</ol>`;
  const help = "Questions or ideas? Just reply. A real person reads every email.";
  let subject: string, heading: string, intro: string, list: string[], cta: string, href: string;
  if (w.member) {
    const { project, by } = w.member;
    subject = `Welcome to ${project.title} on dancerly`;
    heading = `You’re in ${esc(project.title)}`;
    intro = `${esc(by)} invited you to <b>${esc(project.title)}</b>. Here’s how it works:`;
    list = [
      "Watch the team’s practice videos. Tap any note to jump to that exact moment.",
      "Pause on a count you notice and leave a note. Short is fine.",
      "When you practice, upload your take and see which notes you fixed.",
    ];
    cta = `Open ${project.title}`;
    href = `${SITE}/app/p/${project.id}?ref=email_welcome`;
  } else {
    subject = "Welcome to dancerly";
    heading = `Welcome to dancerly, ${esc(name)}`;
    intro = "dancerly turns practice videos into feedback your team can act on. A week usually goes like this:";
    list = [
      "Upload a practice video. A phone clip is plenty.",
      "Your team pauses on the exact count and leaves notes.",
      "Upload the next take and see which notes got fixed.",
    ];
    const l = w.leader;
    [cta, href] = !l ? ["Create your team", `${SITE}/app?ref=email_welcome`]
      : l.hasVideo ? ["Invite your team", `${SITE}/app/p/${l.id}/people?invite=1&ref=email_welcome`]
      : ["Upload your first video", `${SITE}/app/p/${l.id}?upload=1&ref=email_welcome`];
  }
  const tail = w.member ? help : `It’s free for your whole team. ${help}`;
  const body = `<p style="margin:0;font-size:15px;line-height:1.55">${intro}</p>\n${steps(list)}\n${p(tail)}`;
  const plain = (t: string) => t.replace(/<[^>]+>/g, "");
  return {
    subject,
    html: layout({ heading, body, cta, ctaHref: href, footer: footerFor("A one-time welcome email", unsub, GROUP_LABEL.onboarding) }),
    text: `${plain(heading)}\n\n${plain(intro)}\n${list.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\n${tail}\n\n${cta}: ${href}\n\nTurn off: ${unsub}`,
  };
}

async function welcome(key: string) {
  const now = Date.now();
  const from = Math.max(Date.parse(WELCOME_FROM), now - 2 * 864e5);
  const { data: fresh } = await admin.from("profiles").select("id, display_name, created_at")
    .gte("created_at", new Date(from).toISOString()).lte("created_at", new Date(now - WELCOME_DELAY_MIN * 60e3).toISOString()).limit(500);
  const users = (fresh ?? []).filter((p: any) => !isPersona(p.id));
  if (!users.length) return 0;
  const ids = users.map((p: any) => p.id);
  const [{ data: settings }, { data: logged }, { data: members }] = await Promise.all([
    admin.from("notification_settings").select("user_id, email, timezone").in("user_id", ids),
    admin.from("email_log").select("user_id").eq("kind", "welcome").in("user_id", ids),
    admin.from("project_members").select("user_id, role, project_id, joined_at, projects(title, created_by, is_sample, deleted_at)").in("user_id", ids),
  ]);
  const prefs = new Map((settings ?? []).map((s: any) => [s.user_id, s]));
  const done = new Set((logged ?? []).map((l: any) => l.user_id));
  let sent = 0;
  for (const p of users) {
    if (done.has(p.id) || prefs.get(p.id)?.email?.onboarding === false) continue;
    const h = hourIn(prefs.get(p.id)?.timezone || DIGEST_ZONE);
    if (h >= QUIET_FROM || h < QUIET_TO) continue; // waits for the morning
    const mine = (members ?? []).filter((m: any) => m.user_id === p.id && m.projects && !m.projects.is_sample && !m.projects.deleted_at);
    const joined = mine.filter((m: any) => m.role === "member").sort((a: any, b: any) => Date.parse(a.joined_at) - Date.parse(b.joined_at))[0];
    const owned = mine.filter((m: any) => m.role === "owner").sort((a: any, b: any) => Date.parse(b.joined_at) - Date.parse(a.joined_at))[0];
    let w: Parameters<typeof welcomeEmail>[1] = {};
    if (joined) {
      const { data: owner } = await admin.from("profiles").select("display_name").eq("id", joined.projects.created_by).maybeSingle();
      w = { member: { project: { id: joined.project_id, title: joined.projects.title }, by: owner?.display_name ? first(owner.display_name) : "Your teammate" } };
    } else if (owned) {
      const { count } = await admin.from("takes").select("id", { count: "exact", head: true }).eq("project_id", owned.project_id).is("deleted_at", null);
      w = { leader: { id: owned.project_id, title: owned.projects.title, hasVideo: Boolean(count) } };
    }
    const to = await emailOf(p.id);
    if (!to) continue;
    const { error: dup } = await admin.from("email_log").insert({ user_id: p.id, kind: "welcome", period: "once" });
    if (dup) continue;
    const unsub = await unsubUrl(key, p.id, "onboarding");
    const { subject, html, text } = welcomeEmail(first(p.display_name), w, unsub);
    if (await send(to, subject, html, text, "dancerly", unsub)) sent++;
    else await admin.from("email_log").delete().match({ user_id: p.id, kind: "welcome", period: "once" });
  }
  return sent;
}

// ---------- weekly ----------
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The weekly email's words. A week with fixes celebrates them, showing only the numbers that aren't zero.
// A week with uploads but no fixes yet never says "0": it names the one next step instead —
// invite someone when the uploader is alone, or leave the first note when the team is there.
function weeklyContent(w: {
  myFixes: number; myTakes: number; landed: number;
  team: { title: string; fixes: number; takes: number }[];
  solo: boolean; next: { project: string; title: string; href: string } | null;
  recap: { project: string; headline: string; href: string } | null;
  unsub: string;
}) {
  const teamFixes = w.team.reduce((s, x) => s + x.fixes, 0);
  const won = w.myFixes + w.landed + teamFixes > 0;
  const stat = (n: number, label: string) => `<td style="padding:10px 8px;text-align:center"><div style="font-size:26px;font-weight:800;letter-spacing:-0.02em">${n}</div><div style="font-size:12px;color:#80869a">${label}</div></td>`;
  const p = (t: string) => `<p style="margin:10px 0 0;font-size:15px;line-height:1.55">${t}</p>`;
  // The team recap dancerly wrote this past week: one line and a link, not the whole recap.
  const recapBlock = w.recap ? `<p style="margin:18px 0 0;padding:12px 14px;border:1px solid #e3e5ec;border-radius:8px;font-size:14px;line-height:1.5"><span style="font-size:12px;color:#80869a">Team recap · ${esc(w.recap.project)}</span><br>${esc(w.recap.headline)} <a href="${w.recap.href}" style="color:#5b5ce2">Read it</a></p>` : "";
  const recapText = w.recap ? `\n\nTeam recap (${w.recap.project}): ${w.recap.headline}\n${w.recap.href}` : "";
  if (won) {
    const lead = w.myFixes ? `${plural(w.myFixes, "note")} fixed in your takes`
      : teamFixes ? `${plural(teamFixes, "note")} fixed across your team`
      : `${w.landed} of your notes landed`;
    const cells = [
      w.myFixes ? stat(w.myFixes, "fixed in your takes") : "",
      w.landed ? stat(w.landed, "of your notes landed") : "",
      w.myTakes ? stat(w.myTakes, w.myTakes === 1 ? "take you uploaded" : "takes you uploaded") : "",
    ].filter(Boolean).join("");
    const teamLines = w.team.filter((x) => x.fixes || x.takes).map((x) => `<p style="margin:8px 0 0;font-size:14px;line-height:1.5"><b>${esc(x.title)}</b>: ${[x.fixes ? `${plural(x.fixes, "note")} fixed` : "", x.takes ? plural(x.takes, "new take") : ""].filter(Boolean).join(", ")}</p>`).join("");
    const body = `<table role="presentation" style="width:100%;border-collapse:collapse;margin:8px 0"><tr>${cells}</tr></table>
${teamLines}${recapBlock}`;
    const heading = "Here’s what got better last week";
    return {
      subject: `Your week: ${lead}`,
      html: layout({ heading, body, cta: "See your progress", ctaHref: `${SITE}/app/insights?ref=email_weekly`, footer: footerFor("Your weekly progress on dancerly", w.unsub, GROUP_LABEL.weekly) }),
      text: `Your week: ${lead}\n${w.myFixes ? `Fixed in your takes: ${w.myFixes}\n` : ""}${w.landed ? `Your notes that landed: ${w.landed}\n` : ""}${w.myTakes ? `Takes you uploaded: ${w.myTakes}\n` : ""}${w.team.filter((x) => x.fixes || x.takes).map((x) => `${x.title}: ${x.fixes} fixed, ${x.takes} new takes`).join("\n")}${recapText}\n\n${SITE}/app/insights\n\nTurn off: ${w.unsub}`,
    };
  }
  // Uploads, nothing fixed yet: one next step, no zeros.
  const takes = w.myTakes || w.team.reduce((s, x) => s + x.takes, 0);
  const subject = w.solo ? `Your ${takes === 1 ? "video is" : "videos are"} ready for feedback` : `${plural(takes, "new take")} waiting for notes`;
  const where = w.next ? ` in <b>${esc(w.next.project)}</b>` : "";
  const body = w.solo
    ? `${p(`You uploaded ${plural(takes, "take")}${where} last week. Nice start.`)}${p("Invite your teammates or your coach with one link. They can join from their phone in seconds, no app to install.")}`
    : `${p(`${plural(takes, "new take")}${where} went up last week, and nobody has left a note yet.`)}${p("Pause on one moment and say what you see. Short is fine.")}`;
  const cta = w.solo ? "Invite your team" : "Leave the first note";
  const href = w.next ? w.next.href : `${SITE}/app?ref=email_weekly`;
  return {
    subject,
    html: layout({ heading: w.solo ? "Feedback starts when someone else watches" : "One note gets the team going", body, cta, ctaHref: href, footer: footerFor("Your weekly progress on dancerly", w.unsub, GROUP_LABEL.weekly) }),
    text: `${subject}\n\n${w.solo ? `You uploaded ${plural(takes, "take")} last week. Feedback starts when someone else watches: invite your teammates or your coach with one link.` : `${plural(takes, "new take")} went up last week, and nobody has left a note yet. Pause on one moment and say what you see.`}\n\n${href}\n\nTurn off: ${w.unsub}`,
  };
}

async function weekly(key: string) {
  // Monday 8 AM where each person is. Most runs, that's nowhere: check the time zones in use before any heavy query.
  const { data: zones } = await admin.from("notification_settings").select("user_id, timezone").limit(50000);
  const zoneOf = new Map((zones ?? []).map((z: any) => [z.user_id, z.timezone || DIGEST_ZONE]));
  const mondayMorning = (zone: string) => { try { return weekdayIn(zone) === "Mon" && hourIn(zone) === DIGEST_HOUR; } catch { return false; } };
  const due = new Set([DIGEST_ZONE, ...zoneOf.values()].filter(mondayMorning));
  if (!due.size) return 0;
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data: real } = await admin.from("projects").select("id, title, created_by").eq("is_sample", false).is("deleted_at", null);
  const realIds = new Set((real ?? []).map((p: any) => p.id));
  const owned = new Map<string, any[]>();
  for (const p of real ?? []) owned.set(p.created_by, [...(owned.get(p.created_by) ?? []), p]);
  const [{ data: fixed }, { data: takes }, { data: roster }, { data: recaps }] = await Promise.all([
    admin.from("notes").select("id, project_id, author_id, take_id, takes(uploaded_by)").eq("status", "resolved").gte("resolved_at", since).limit(5000),
    admin.from("takes").select("id, number, project_id, video_id, uploaded_by, created_at").is("deleted_at", null).gte("created_at", since).order("created_at", { ascending: false }).limit(5000),
    admin.from("project_members").select("project_id, user_id").limit(20000),
    admin.from("recaps").select("id, project_id, content").eq("team", true).gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
  ]);
  const fx = (fixed ?? []).filter((n: any) => realIds.has(n.project_id));
  const tk = (takes ?? []).filter((t: any) => realIds.has(t.project_id));
  const membersOf = new Map<string, number>();
  for (const m of roster ?? []) membersOf.set(m.project_id, (membersOf.get(m.project_id) ?? 0) + 1);
  const titleOf = new Map((real ?? []).map((p: any) => [p.id, p.title]));
  const people = new Set<string>([...fx.map((n: any) => n.takes?.uploaded_by), ...fx.map((n: any) => n.author_id), ...tk.map((t: any) => t.uploaded_by)].filter(Boolean));
  for (const [owner, ps] of owned) if (ps.some((p) => fx.some((n: any) => n.project_id === p.id) || tk.some((t: any) => t.project_id === p.id))) people.add(owner);
  if (!people.size) return 0;
  const { data: settings } = await admin.from("notification_settings").select("user_id, email").in("user_id", [...people]);
  const optedOut = new Set((settings ?? []).filter((s: any) => s.email?.weekly === false).map((s: any) => s.user_id));
  // Got the "invite your team" email this past week: a weekly saying the same thing would be a repeat.
  const { data: invited } = await admin.from("email_log").select("user_id").eq("kind", "invite_nudge").gte("sent_at", since).in("user_id", [...people]);
  const justInvited = new Set((invited ?? []).map((l: any) => l.user_id));
  let sent = 0;
  for (const user of people) {
    const zone = zoneOf.get(user) ?? DIGEST_ZONE;
    if (optedOut.has(user) || !due.has(zone)) continue;
    const week = localWeek(zone);
    const myFixes = fx.filter((n: any) => n.takes?.uploaded_by === user).length;
    const myTakes = tk.filter((t: any) => t.uploaded_by === user).length;
    const landed = fx.filter((n: any) => n.author_id === user).length;
    const team = (owned.get(user) ?? []).map((p) => ({ title: p.title, id: p.id, fixes: fx.filter((n: any) => n.project_id === p.id).length, takes: tk.filter((t: any) => t.project_id === p.id).length })).filter((x) => x.fixes || x.takes);
    if (!myFixes && !myTakes && !landed && !team.length) continue;
    // The newest take this person uploaded (or, for an owner, one in their projects): where the next step points.
    const latest = tk.find((t: any) => t.uploaded_by === user) ?? tk.find((t: any) => team.some((x) => x.id === t.project_id));
    const solo = latest ? (membersOf.get(latest.project_id) ?? 1) <= 1 : false;
    const next = latest ? {
      project: titleOf.get(latest.project_id) ?? "",
      title: "",
      href: solo ? `${SITE}/app/p/${latest.project_id}/people?invite=1&ref=email_weekly` : `${SITE}/app/p/${latest.project_id}/v/${latest.video_id}?take=${latest.number}&ref=email_weekly`,
    } : null;
    if (solo && justInvited.has(user) && !myFixes && !landed && !team.some((x) => x.fixes)) continue;
    const mine = new Set((roster ?? []).filter((m: any) => m.user_id === user).map((m: any) => m.project_id));
    const r = (recaps ?? []).find((x: any) => mine.has(x.project_id) && realIds.has(x.project_id));
    const recap = r ? { project: titleOf.get(r.project_id) ?? "", headline: String(r.content?.headline ?? ""), href: `${SITE}/app/recaps/${r.id}?ref=email_weekly` } : null;
    const { error: dup } = await admin.from("email_log").insert({ user_id: user, kind: "weekly", period: week });
    if (dup) continue;
    const to = await emailOf(user);
    if (!to) continue;
    const unsub = await unsubUrl(key, user, "weekly");
    const { subject, html, text } = weeklyContent({ myFixes, myTakes, landed, team, solo, next, recap, unsub });
    if (await send(to, subject, html, text, "dancerly", unsub)) sent++;
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
  const previewFor = new URL(req.url).searchParams.get("preview");
  if (previewFor && /^[0-9a-f-]{36}$/.test(previewFor)) return Response.json(await preview(key, previewFor));
  const welcomed = await welcome(key);
  const result = await followUp(key);
  const weeklySent = await weekly(key);
  const nudged = await startNudge(key);
  const invited = await inviteNudge(key);
  return Response.json({ ...result, weekly: weeklySent, start_nudge: nudged, invite_nudge: invited, welcome: welcomed });
});
