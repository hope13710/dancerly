// delete-account: permanently deletes the signed-in person's account.
// Steps, in order, so nothing is half-done: confirm it's really them (password + typed email) → check every
// project they manage has a decision (hand over or delete) → apply those → remove their files from storage →
// delete their videos nobody else added takes to → delete the user (their own rows cascade; team rows stay).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
// Sample-project teammates aren't real people; a project with only them counts as yours alone.
const isSamplePerson = (id: string) => id.startsWith("5a3b0000-");
const REASONS = new Set(["not_using", "missing_feature", "too_hard", "privacy", "switching", "team_left", "other"]);

type Decision = { action: "transfer"; to: string } | { action: "delete" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(jwt);
  const user = auth?.user;
  if (!user) return json({ error: "Your session ended. Log in again.", code: "unauthenticated" }, 401);

  let body: { password?: string; confirm?: string; decisions?: Record<string, Decision>; reason?: string; details?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }

  // 1. It's really them: the typed email matches, and the password is right.
  if (!user.email || String(body.confirm || "").trim().toLowerCase() !== user.email.toLowerCase()) {
    return json({ error: "Type your email address exactly to confirm.", code: "confirm" }, 400);
  }
  const check = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: pwError } = await check.auth.signInWithPassword({ email: user.email, password: String(body.password || "") });
  if (pwError) return json({ error: "That password isn’t right.", code: "password" }, 403);
  await check.auth.signOut().catch(() => {});

  // 2. Every project they manage alone, with other people in it, needs a decision.
  const { data: owned } = await admin.from("project_members").select("project_id, projects(id, title, is_sample, deleted_at)").eq("user_id", user.id).eq("role", "owner");
  const decisions = body.decisions || {};
  const toDelete: string[] = [];
  const transfers: { project: string; to: string }[] = [];
  const undecided: { id: string; title: string }[] = [];
  for (const row of owned || []) {
    const project = (row as { projects: { id: string; title: string; is_sample?: boolean; deleted_at?: string | null } | null }).projects;
    if (!project) continue;
    if (project.deleted_at) { toDelete.push(project.id); continue; } // already in their Trash: it just goes
    const { data: members } = await admin.from("project_members").select("user_id, role").eq("project_id", project.id);
    const others = (members || []).filter((m) => m.user_id !== user.id && !isSamplePerson(m.user_id));
    if (project.is_sample || !others.length) { toDelete.push(project.id); continue; }
    if (others.some((m) => m.role === "owner")) continue; // someone else already manages it
    const d = decisions[project.id];
    if (d?.action === "delete") toDelete.push(project.id);
    else if (d?.action === "transfer" && others.some((m) => m.user_id === d.to)) transfers.push({ project: project.id, to: d.to });
    else undecided.push({ id: project.id, title: project.title });
  }
  if (undecided.length) return json({ error: "Choose what happens to each project you manage.", code: "undecided", projects: undecided }, 409);

  // 3. Collect files first. This helper comes with the database change that keeps team projects alive when
  // their creator leaves — without it, deleting the user would still wipe handed-over projects, so stop here.
  const { data: files, error: filesError } = await admin.rpc("storage_paths_for_deletion", { p_user: user.id, p_projects: toDelete });
  if (filesError) return json({ error: "Account deletion isn’t available yet. Contact us and we’ll delete your account for you.", code: "not_ready" }, 503);

  // 4. Apply: hand projects over, delete what goes, remove files.
  for (const t of transfers) {
    const { error } = await admin.from("project_members").update({ role: "owner" }).eq("project_id", t.project).eq("user_id", t.to);
    if (error) return json({ error: "Couldn’t hand over a project. Nothing was deleted — try again." }, 500);
  }
  if (toDelete.length) {
    const { error } = await admin.from("projects").delete().in("id", toDelete);
    if (error) return json({ error: "Couldn’t delete your projects. Try again." }, 500);
  }
  // Their videos that only they added takes to go too; videos others added takes to stay with those takes.
  const { data: myVideos } = await admin.from("videos").select("id, takes(uploaded_by)").eq("created_by", user.id);
  const solo = (myVideos || []).filter((v: { takes: { uploaded_by: string }[] }) => v.takes.every((t) => t.uploaded_by === user.id)).map((v: { id: string }) => v.id);
  if (solo.length) await admin.from("videos").delete().in("id", solo);

  const byBucket: Record<string, string[]> = {};
  for (const f of (files || []) as { bucket: string; name: string }[]) (byBucket[f.bucket] ||= []).push(f.name);
  for (const [bucket, names] of Object.entries(byBucket)) {
    for (let i = 0; i < names.length; i += 100) await admin.storage.from(bucket).remove(names.slice(i, i + 100));
  }

  // 5. The account itself. Their own rows (takes, notes, replies, reactions, summaries, links) cascade.
  const { error: delError } = await admin.auth.admin.deleteUser(user.id);
  if (delError) return json({ error: "Couldn’t finish deleting your account. Contact us and we’ll do it for you." }, 500);

  const reason = REASONS.has(String(body.reason)) ? String(body.reason) : null;
  const details = String(body.details || "").trim().slice(0, 1000) || null;
  if (reason || details) await admin.from("account_deletion_feedback").insert({ reason, details });

  return json({ ok: true, projects_deleted: toDelete.length, projects_handed_over: transfers.length });
});
