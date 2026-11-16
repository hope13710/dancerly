// send-invite: emails a project's invite link to people, in the inviter's name, from the invite box.
//   POST { project_id, emails[], lang }  (signed in)  → one email per address: who invited you, to what, who's already
//     there, one button to join. At most 10 addresses at a time and 30 a day per person; the same address
//     isn't emailed again for the same project within a day. The join link fills in their email on sign-up.
//   POST { reminders: true }  (pg_cron, hourly; migration 052) → one reminder 3 days later to anyone who hasn't joined.
// The addresses people type are never shown to anyone else. Secrets: RESEND_API_KEY.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SITE = "https://dancerly.app";
const FROM_ADDRESS = "notifications@dancerly.app";
const REPLY_TO = "help@dancerly.app";
const PER_REQUEST = 10;
const PER_DAY = 30;
const DAY = 864e5;
const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const first = (name?: string | null) => (name ?? "").trim().split(/\s+/)[0] || "A teammate";

const url = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

type Copy = { subject: string; heading: string; body: string; cta: string; fine: string; text: string };
function copy(o: { lang: "en"; who: string; project: string; others: string[]; count: number; until: string; reminder: boolean; link: string }): Copy {
  const { who, project, count } = o;
  const named = o.others.slice(0, 2);
  const crowd = count <= 1 ? "" : named.length ? `${named.join(", ")}${count - named.length > 0 ? ` and ${count - named.length} ${count - named.length === 1 ? "other" : "others"} are` : named.length === 1 ? " is" : " are"} already in it.` : `${count} people are already in it.`;
  return {
    subject: o.reminder ? `${who} is waiting for you in ${project}` : `${who} invited you to ${project} on dancerly`,
    heading: o.reminder ? `You haven’t joined ${esc(project)} yet` : `${esc(who)} invited you to ${esc(project)}`,
    body: `<p style="margin:0;font-size:15px;line-height:1.6">dancerly is where your team leaves feedback on the exact moment of a practice video, then sees what got better in the next take. ${esc(crowd)}</p>
<p style="margin:12px 0 0;font-size:15px;line-height:1.6">Joining takes a minute with just your name and email. Nothing to install.</p>`,
    cta: `Join ${project}`,
    fine: `${esc(who)} sent this invite to this address. Not expecting it? You can ignore this email.${o.reminder ? "" : " If you don’t join, we’ll remind you once in 3 days."} The link works until ${esc(o.until)}.`,
    text: `${who} invited you to ${project} on dancerly.\n\n${crowd}\nJoining takes a minute with just your name and email.\n\n${o.link}`,
  };
}

function html(c: Copy, link: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;color:#15161a">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(c.text.split("\n\n")[1] || "")}${"&#8199;&#65279;&#847; ".repeat(40)}</div>
<div style="max-width:520px;margin:0 auto;padding:28px 16px">
<a href="${SITE}" style="display:inline-block;margin:0 0 18px"><img src="${SITE}/logo-wordmark.png" alt="dancerly" width="102" height="24" style="display:block;height:24px;width:auto;border:0" /></a>
<div style="background:#fff;border-radius:14px;padding:24px 22px;border:1px solid #e7e8ee">
<h1 style="margin:0 0 14px;font-size:19px;line-height:1.35;letter-spacing:-0.01em">${c.heading}</h1>
${c.body}
<p style="margin:22px 0 2px"><a href="${link}" style="display:inline-block;background:#5b5ce2;color:#fff;text-decoration:none;font-weight:650;font-size:14px;padding:11px 18px;border-radius:10px">${esc(c.cta)}</a></p>
</div>
<p style="margin:16px 4px 0;font-size:12px;line-height:1.6;color:#80869a">${c.fine}<br>dancerly · Every dancer deserves to see their progress.</p>
</div></body></html>`;
}

async function send(to: string, fromName: string, c: Copy, link: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    // A name with a comma, quote or angle bracket would break the From line.
    body: JSON.stringify({ from: `${fromName.replace(/[<>",;]/g, "").trim() || "A teammate"} via dancerly <${FROM_ADDRESS}>`, to: [to], reply_to: REPLY_TO, subject: c.subject, html: html(c, link), text: `${c.text}\n\n${c.fine.replace(/<[^>]+>/g, "")}` }),
  });
  if (!res.ok) console.error("resend", res.status, (await res.text()).slice(0, 300));
  return res.ok;
}

// What every email about one project needs: its name, a live invite code, who's in it, and who's inviting.
async function context(projectId: string, inviter: string) {
  const [{ data: project }, { data: invite }, { data: members }, { data: me }] = await Promise.all([
    admin.from("projects").select("id, title, is_sample, deleted_at").eq("id", projectId).maybeSingle(),
    admin.from("project_invites").select("code, expires_at").eq("project_id", projectId).eq("revoked", false)
      .gt("expires_at", new Date(Date.now() + DAY).toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("project_members").select("user_id, joined_at").eq("project_id", projectId).order("joined_at").limit(50),
    admin.from("profiles").select("display_name").eq("id", inviter).maybeSingle(),
  ]);
  const people = (members ?? []).filter((m: { user_id: string }) => !m.user_id.startsWith("5a3b0000-"));
  const ids = people.filter((m) => m.user_id !== inviter).map((m) => m.user_id).slice(0, 2);
  const { data: names } = ids.length ? await admin.from("profiles").select("id, display_name").in("id", ids) : { data: [] };
  return {
    project, invite,
    who: first(me?.display_name),
    count: people.length,
    // Up to two teammates by name ("Jordan, Hana and 3 others are already in it"), oldest members first.
    others: ids.map((id) => first((names ?? []).find((n: { id: string }) => n.id === id)?.display_name)).filter((n) => n !== "A teammate"),
  };
}
const joinLink = (code: string, email: string, reminder: boolean) =>
  `${SITE}/app/join/${code}?email=${encodeURIComponent(email)}&ref=${reminder ? "email_invite_reminder" : "email_invite"}`;
const untilLabel = (iso: string, lang: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric" });

// ---------- Reminders (hourly) ----------
async function reminders() {
  const { data: due } = await admin.rpc("invite_reminders_due");
  let sent = 0;
  for (const r of due ?? []) {
    // Marked first, so a slow run never reminds twice.
    const { data: claimed } = await admin.from("invite_emails").update({ reminded_at: new Date().toISOString() }).eq("id", r.id).is("reminded_at", null).select("id");
    if (!claimed?.length) continue;
    const c = await context(r.project_id, r.invited_by);
    if (!c.project || c.project.is_sample || c.project.deleted_at || !c.invite) continue; // link expired: the inviter makes a new one
    const link = joinLink(c.invite.code, r.email, true);
    if (await send(r.email, c.who, copy({ lang: "en", who: c.who, project: c.project.title, others: c.others, count: c.count, until: untilLabel(c.invite.expires_at, r.lang), reminder: true, link }), link)) sent++;
  }
  return { reminded: sent };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!Deno.env.get("RESEND_API_KEY")) return json({ error: "Email isn’t set up yet." }, 503);

  const cronHeader = req.headers.get("x-cron-secret");
  if (cronHeader) {
    const { data: secret } = await admin.rpc("email_cron_secret");
    if (!secret || cronHeader !== secret) return json({ error: "forbidden" }, 403);
    return json(await reminders());
  }

  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: userData } = await asUser.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: "Your session ended. Log in again." }, 401);

  let body: { project_id?: string; emails?: unknown; lang?: string };
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  const projectId = String(body.project_id ?? "");
  const lang = "en";
  if (!/^[0-9a-f-]{36}$/.test(projectId)) return json({ error: "Pick a project first." }, 400);
  const emails = [...new Set((Array.isArray(body.emails) ? body.emails : []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) return json({ error: "Enter an email address." }, 400);
  if (emails.length > PER_REQUEST) return json({ error: `Up to ${PER_REQUEST} addresses at a time.` }, 400);

  // Membership through row-level security: you can only invite to a project you're in (and not the sample).
  const { data: visible } = await asUser.from("projects").select("id, is_sample").eq("id", projectId).maybeSingle();
  if (!visible || visible.is_sample) return json({ error: "You can’t invite people to this project." }, 403);

  const { count: today } = await admin.from("invite_emails").select("id", { count: "exact", head: true })
    .eq("invited_by", user.id).gte("sent_at", new Date(Date.now() - DAY).toISOString());
  if ((today ?? 0) + emails.length > PER_DAY) return json({ error: "That’s a lot of invites for one day. Share the link instead, or try again tomorrow." }, 429);

  // A live invite link (made the same way the app makes one, as the inviter, if there isn't one yet).
  let c = await context(projectId, user.id);
  if (!c.invite) {
    const { error } = await asUser.from("project_invites").insert({ project_id: projectId });
    if (error) return json({ error: "Couldn’t make an invite link. Try again." }, 500);
    c = await context(projectId, user.id);
  }
  if (!c.project || !c.invite) return json({ error: "Couldn’t make an invite link. Try again." }, 500);

  const results: { email: string; status: "sent" | "invalid" | "recent" | "you" | "failed" }[] = [];
  for (const email of emails) {
    if (!EMAIL.test(email)) { results.push({ email, status: "invalid" }); continue; }
    if (email === (user.email ?? "").toLowerCase()) { results.push({ email, status: "you" }); continue; }
    const { data: prior } = await admin.from("invite_emails").select("id, sent_at").eq("project_id", projectId).eq("email", email).maybeSingle();
    if (prior && Date.now() - Date.parse(prior.sent_at) < DAY) { results.push({ email, status: "recent" }); continue; }
    const link = joinLink(c.invite.code, email, false);
    const ok = await send(email, c.who, copy({ lang, who: c.who, project: c.project.title, others: c.others, count: c.count, until: untilLabel(c.invite.expires_at, lang), reminder: false, link }), link);
    if (!ok) { results.push({ email, status: "failed" }); continue; }
    await admin.from("invite_emails").upsert({ project_id: projectId, invited_by: user.id, email, lang, sent_at: new Date().toISOString(), reminded_at: null }, { onConflict: "project_id,email" });
    results.push({ email, status: "sent" });
  }
  const sent = results.filter((r) => r.status === "sent").length;
  if (sent) await admin.from("product_events").insert({ user_id: user.id, event: "invite_email_sent", props: { project_id: projectId, count: sent } });
  return json({ results, sent });
});
