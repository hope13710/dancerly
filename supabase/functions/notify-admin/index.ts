// notify-admin: emails the founder when someone starts using dancerly — a new signup, their first project,
// their first upload, and the first teammate joining a project. Called by database triggers (migration 039)
// with the same secret the email cron uses; nobody else can call it.
// Secrets: RESEND_API_KEY, ADMIN_EMAIL (where the alerts go).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const FROM = "dancerly <notifications@dancerly.app>";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const uuid = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{36}$/.test(s);

async function person(id: string) {
  const [{ data: profile }, { data: auth }] = await Promise.all([
    admin.from("profiles").select("display_name, created_at").eq("id", id).maybeSingle(),
    admin.auth.admin.getUserById(id),
  ]);
  const meta = (auth?.user?.user_metadata ?? {}) as Record<string, unknown>;
  return {
    name: profile?.display_name || "(no name yet)",
    email: auth?.user?.email ?? "",
    source: String(meta.signup_source ?? "") || "(unknown)",
    via: auth?.user?.app_metadata?.provider ?? "email",
  };
}

async function project(id: string) {
  const { data } = await admin.from("projects").select("title, created_by, created_at").eq("id", id).maybeSingle();
  const { count } = await admin.from("project_members").select("user_id", { count: "exact", head: true }).eq("project_id", id);
  return { title: data?.title ?? "(deleted)", owner: data?.created_by ?? null, members: count ?? 0 };
}

// What each alert says: a subject line and a few label/value rows.
async function compose(kind: string, id: string, extra: string | null): Promise<{ subject: string; rows: [string, string][] } | null> {
  if (kind === "signup") {
    const p = await person(id);
    return { subject: `🆕 New signup: ${p.name}`, rows: [["Name", p.name], ["Email", p.email], ["Came from", p.source], ["Signed up with", p.via]] };
  }
  if (kind === "first_project") {
    const pr = await project(id);
    const p = pr.owner ? await person(pr.owner) : null;
    return { subject: `📁 First project: ${pr.title}${p ? ` (${p.name})` : ""}`, rows: [["Project", pr.title], ["By", p ? `${p.name} · ${p.email}` : "—"], ["Came from", p?.source ?? "—"]] };
  }
  if (kind === "first_upload") {
    const { data: take } = await admin.from("takes").select("number, uploaded_by, project_id, videos(title)").eq("id", id).maybeSingle();
    if (!take) return null;
    const pr = await project(take.project_id);
    const p = await person(take.uploaded_by);
    const title = (take as { videos?: { title?: string } }).videos?.title ?? "a video";
    return { subject: `🎥 First upload: ${p.name} (${pr.title})`, rows: [["Video", `${title} · Take ${take.number}`], ["Project", `${pr.title} · ${pr.members} ${pr.members === 1 ? "member" : "members"}`], ["By", `${p.name} · ${p.email}`], ["Came from", p.source]] };
  }
  if (kind === "first_teammate" && extra) {
    const pr = await project(id);
    const [owner, joined] = await Promise.all([pr.owner ? person(pr.owner) : null, person(extra)]);
    return { subject: `👋 First teammate joined ${pr.title}`, rows: [["Project", pr.title], ["Joined", `${joined.name} · ${joined.email}`], ["Owner", owner ? `${owner.name} · ${owner.email}` : "—"]] };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const { data: key } = await admin.rpc("email_cron_secret");
  if (!key || req.headers.get("x-cron-secret") !== key) return new Response("forbidden", { status: 403 });
  const to = Deno.env.get("ADMIN_EMAIL");
  if (!to || !Deno.env.get("RESEND_API_KEY")) return Response.json({ skipped: "ADMIN_EMAIL or RESEND_API_KEY is not set" });

  let body: { kind?: string; id?: string; extra?: string | null } = {};
  try { body = await req.json(); } catch { /* empty */ }
  if (!body.kind || !uuid(body.id) || (body.extra && !uuid(body.extra))) return Response.json({ error: "bad request" }, { status: 400 });
  const msg = await compose(body.kind, body.id!, body.extra ?? null);
  if (!msg) return Response.json({ skipped: "nothing to say" });

  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;color:#15161a">
<div style="max-width:520px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border-radius:14px;padding:22px;border:1px solid #e7e8ee">
<h1 style="margin:0 0 14px;font-size:18px;line-height:1.35">${esc(msg.subject)}</h1>
<table style="border-collapse:collapse;font-size:14px;line-height:1.5">${msg.rows.map(([k, v]) => `<tr><td style="padding:3px 14px 3px 0;color:#80869a;white-space:nowrap">${esc(k)}</td><td style="padding:3px 0">${esc(v)}</td></tr>`).join("")}</table>
</div><p style="margin:12px 4px 0;font-size:12px;color:#80869a">dancerly admin alert · ${esc(new Date().toISOString().slice(0, 16).replace("T", " "))} UTC</p></div></body></html>`;
  const text = `${msg.subject}\n\n${msg.rows.map(([k, v]) => `${k}: ${v}`).join("\n")}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject: msg.subject, html, text }),
  });
  if (!res.ok) {
    console.error("resend", res.status, (await res.text()).slice(0, 300));
    return Response.json({ error: "send failed" }, { status: 502 });
  }
  return Response.json({ ok: true });
});
