// shared-video: what a guest link (/app/s/:token) shows — one video's latest take and, if allowed, its notes.
// Read-only; the link expires and can be turned off by whoever made it or the project owner.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let token = "";
  try { token = (await req.json()).token ?? ""; } catch { /* empty body */ }
  if (!/^[0-9a-f]{36}$/.test(token)) return json({ error: "This link isn’t valid." }, 404);

  const { data: share } = await admin.from("video_shares").select("video_id, include_notes, expires_at, revoked, views").eq("token", token).maybeSingle();
  if (!share || share.revoked) return json({ error: "This link was turned off." }, 404);
  if (new Date(share.expires_at) < new Date()) return json({ error: "This link has expired. Ask for a new one." }, 410);

  const { data: video } = await admin.from("videos").select("id, title, projects(title)").eq("id", share.video_id).maybeSingle();
  if (!video) return json({ error: "This video was deleted." }, 404);
  const { data: take } = await admin.from("takes").select("id, number, storage_path, created_at").eq("video_id", video.id).order("number", { ascending: false }).limit(1).maybeSingle();
  if (!take) return json({ error: "This video has no takes yet." }, 404);
  const { data: signed } = await admin.storage.from("takes").createSignedUrl(take.storage_path, 60 * 60 * 2);

  let notes: unknown[] = [];
  if (share.include_notes) {
    const { data } = await admin.from("notes").select("id, body, t_start, t_end, status, author_id, take_id").eq("video_id", video.id).order("t_start");
    // Notes on this take, plus anything from earlier takes that isn't fixed — the same view the team sees.
    const { data: takes } = await admin.from("takes").select("id, number").eq("video_id", video.id);
    const num = Object.fromEntries((takes ?? []).map((t: { id: string; number: number }) => [t.id, t.number]));
    const visible = (data ?? []).filter((n: { take_id: string; status: string }) => n.take_id === take.id || (num[n.take_id] < take.number && n.status !== "resolved"));
    const ids = [...new Set(visible.map((n: { author_id: string }) => n.author_id))];
    const { data: people } = ids.length ? await admin.from("profiles").select("id, display_name").in("id", ids) : { data: [] };
    const name = Object.fromEntries((people ?? []).map((p: { id: string; display_name: string }) => [p.id, p.display_name]));
    notes = visible.map((n: { id: string; body: string; t_start: number; t_end: number | null; status: string; author_id: string }) => ({
      id: n.id, body: n.body, t_start: Number(n.t_start), t_end: n.t_end === null ? null : Number(n.t_end), status: n.status, author: name[n.author_id] ?? "A teammate",
    }));
  }
  admin.from("video_shares").update({ views: share.views + 1 }).eq("token", token).then(() => {});
  return json({
    title: video.title,
    project: (video as { projects?: { title?: string } }).projects?.title ?? "",
    take: take.number,
    uploaded_at: take.created_at,
    url: signed?.signedUrl ?? null,
    expires_at: share.expires_at,
    notes,
  });
});
