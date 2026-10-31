// send-upload-link: "Send the link to my phone" on Home. Emails the signed-in person a link that opens the
// upload for one of their projects, so they can upload from the phone where their rehearsal videos are.
// Only to their own address, only for a project they're in, and at most once per 10 minutes (email_log, migration 035).
// Secrets: RESEND_API_KEY.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SITE = "https://dancerly.app";
const FROM = "dancerly <notifications@dancerly.app>";
const REPLY_TO = "help@dancerly.app";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!Deno.env.get("RESEND_API_KEY")) return json({ error: "Email isn’t set up yet." }, 503);

  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: userData } = await asUser.auth.getUser();
  const user = userData?.user;
  if (!user?.email) return json({ error: "Your session ended. Log in again." }, 401);

  let projectId = "";
  try { projectId = String((await req.json()).project_id ?? ""); } catch { /* empty */ }
  if (!/^[0-9a-f-]{36}$/.test(projectId)) return json({ error: "Pick a project first." }, 400);
  // Read as the person: row-level security says whether they're in it (and that it isn't in the Trash).
  const { data: project } = await asUser.from("projects").select("id, title, is_sample").eq("id", projectId).maybeSingle();
  if (!project || project.is_sample) return json({ error: "This project isn’t available." }, 404);

  // One per 10 minutes: the period is the 10-minute slot, unique per person.
  const now = new Date();
  const slot = `${now.toISOString().slice(0, 14)}${Math.floor(now.getUTCMinutes() / 10)}`; // e.g. 2026-10-31T14:3
  const { error: dup } = await admin.from("email_log").insert({ user_id: user.id, kind: "upload_link", period: slot });
  if (dup?.code === "23505") return json({ error: "We just sent it. Check your email on your phone.", code: "too_soon" }, 429);
  if (dup) return json({ error: "Couldn’t send the email. Try again in a minute." }, 503); // e.g. migration 035 not run yet

  const link = `${SITE}/app/p/${project.id}?upload=1&ref=email_upload_link`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;color:#15161a">
<div style="max-width:520px;margin:0 auto;padding:28px 16px">
<p style="margin:0 0 18px;font-weight:800;font-size:18px;letter-spacing:-0.02em;color:#5b5ce2">dancerly</p>
<div style="background:#fff;border-radius:14px;padding:24px 22px;border:1px solid #e7e8ee">
<h1 style="margin:0 0 12px;font-size:19px;line-height:1.35">Upload from your phone</h1>
<p style="margin:0;font-size:15px;line-height:1.55">Open this on your phone and pick a rehearsal video. It goes straight into <b>${esc(project.title)}</b>.</p>
<p style="margin:22px 0 2px"><a href="${link}" style="display:inline-block;background:#15161a;color:#fff;text-decoration:none;font-weight:650;font-size:14px;padding:11px 18px;border-radius:10px">Upload a video</a></p>
</div>
<p style="margin:16px 4px 0;font-size:12px;line-height:1.6;color:#80869a">You asked for this link on dancerly. If that wasn’t you, you can ignore this email.<br>dancerly · Every dancer deserves to see their progress.</p>
</div></body></html>`;
  const text = `Upload from your phone\n\nOpen this on your phone and pick a rehearsal video. It goes straight into ${project.title}.\n\n${link}\n\nYou asked for this link on dancerly. If that wasn't you, you can ignore this email.`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [user.email], reply_to: REPLY_TO, subject: `Upload to ${project.title} from your phone`, html, text }),
  });
  if (!res.ok) {
    await admin.from("email_log").delete().match({ user_id: user.id, kind: "upload_link", period: slot });
    console.error("resend", res.status, (await res.text()).slice(0, 300));
    return json({ error: "Couldn’t send the email. Try again in a minute." }, 502);
  }
  return json({ ok: true, to: user.email });
});
