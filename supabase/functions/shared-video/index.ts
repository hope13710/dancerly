// shared-video: what a guest link (/app/s/:token) shows — one video's latest take and, if allowed, its notes;
// or, for a Practice link (migration 061), the project's choreo video and its sections.
// Read-only; a link can expire and can be turned off by whoever made it or the project owner.
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

  // "*" so the link keeps working whether or not allow_requests (migration 040) is in the database yet.
  const { data: share } = await admin.from("video_shares").select("*").eq("token", token).maybeSingle();
  if (!share) {
    // Not a take link: maybe a Practice link (before migration 061 the table isn't there, and this finds nothing).
    const { data: practice } = await admin.from("practice_shares").select("*").eq("token", token).maybeSingle();
    if (practice) return practiceLink(practice);
  }
  if (!share || share.revoked) return json({ error: "This link was turned off." }, 404);
  if (share.expires_at && new Date(share.expires_at) < new Date()) return json({ error: "This link has expired. Ask for a new one." }, 410);

  // A video, take, or project in the Trash (migrations 032, 033) isn't shown to guests.
  const { data: video } = await admin.from("videos").select("id, title, bpm, projects(title, deleted_at, is_sample)").eq("id", share.video_id).is("deleted_at", null).maybeSingle();
  if (!video || (video as { projects?: { deleted_at?: string | null } }).projects?.deleted_at) return json({ error: "This video was deleted." }, 404);
  const { data: take } = await admin.from("takes").select("id, number, storage_path, created_at, count_start").eq("video_id", video.id).is("deleted_at", null).order("number", { ascending: false }).limit(1).maybeSingle();
  if (!take) return json({ error: "This video has no takes yet." }, 404);
  // Sample-project takes ship with the site ("public:/samples/…"); everything else is signed from storage.
  const url = take.storage_path.startsWith("public:")
    ? take.storage_path.slice("public:".length)
    : (await admin.storage.from("takes").createSignedUrl(take.storage_path, 60 * 60 * 2)).data?.signedUrl ?? null;

  let notes: unknown[] = [];
  if (share.include_notes) {
    // Private notes (to one person) are never shown to guests.
    const { data } = await admin.from("notes").select("id, body, t_start, t_end, status, author_id, take_id, sketch").eq("video_id", video.id).is("private_to", null).order("t_start");
    // Notes on this take, plus anything from earlier takes that isn't fixed — the same view the team sees.
    const { data: takes } = await admin.from("takes").select("id, number").eq("video_id", video.id).is("deleted_at", null);
    const num = Object.fromEntries((takes ?? []).map((t: { id: string; number: number }) => [t.id, t.number]));
    const visible = (data ?? []).filter((n: { take_id: string; status: string }) => n.take_id === take.id || (num[n.take_id] !== undefined && num[n.take_id] < take.number && n.status !== "resolved"));
    const ids = [...new Set(visible.map((n: { author_id: string }) => n.author_id))];
    const { data: people } = ids.length ? await admin.from("profiles").select("id, display_name").in("id", ids) : { data: [] };
    const name = Object.fromEntries((people ?? []).map((p: { id: string; display_name: string }) => [p.id, p.display_name]));
    notes = visible.map((n: { id: string; body: string; t_start: number; t_end: number | null; status: string; author_id: string; sketch: unknown }) => ({
      id: n.id, body: n.body, t_start: Number(n.t_start), t_end: n.t_end === null ? null : Number(n.t_end), status: n.status, author: name[n.author_id] ?? "Someone", sketch: n.sketch ?? null,
    }));
  }
  // Who a request to join goes to (shown as "Sent to Maya"): the project's owner, by first name.
  let owner: string | null = null;
  if (share.allow_requests === true) {
    const { data: o } = await admin.from("project_members").select("user_id").eq("project_id", share.project_id).eq("role", "owner").limit(1).maybeSingle();
    if (o) owner = ((await admin.from("profiles").select("display_name").eq("id", o.user_id).maybeSingle()).data?.display_name ?? "").split(" ")[0] || null;
  }
  admin.from("video_shares").update({ views: share.views + 1 }).eq("token", token).then(() => {});
  return json({
    title: video.title,
    project: (video as { projects?: { title?: string } }).projects?.title ?? "",
    take: take.number,
    uploaded_at: take.created_at,
    url,
    expires_at: share.expires_at,
    bpm: (video as { bpm?: number | null }).bpm ?? null,
    count_start: take.count_start ?? null,
    notes,
    allow_requests: share.allow_requests === true && !(video as { projects?: { is_sample?: boolean } }).projects?.is_sample,
    owner,
  });
});

// A Practice link: the choreo video (a YouTube id, or a signed URL for an uploaded file) and its sections, read-only.
async function practiceLink(ps: any) {
  if (ps.revoked) return json({ error: "This link was turned off." }, 404);
  if (ps.expires_at && new Date(ps.expires_at) < new Date()) return json({ error: "This link has expired. Ask for a new one." }, 410);
  const { data: project } = await admin.from("projects").select("id, title, deleted_at, is_sample, choreo_video_id, choreo_youtube, choreo_title").eq("id", ps.project_id).maybeSingle();
  if (!project || project.deleted_at || project.is_sample) return json({ error: "This page isn’t available." }, 404);
  let choreo: Record<string, unknown> | null = null;
  let title = project.choreo_title ?? "";
  if (project.choreo_youtube) {
    choreo = { kind: "youtube", id: project.choreo_youtube, title: project.choreo_title ?? "" };
  } else if (project.choreo_video_id) {
    const { data: video } = await admin.from("videos").select("id, title, bpm").eq("id", project.choreo_video_id).is("deleted_at", null).maybeSingle();
    const { data: take } = video ? await admin.from("takes").select("storage_path, count_start").eq("video_id", video.id).is("deleted_at", null).order("number", { ascending: false }).limit(1).maybeSingle() : { data: null };
    if (video && take) {
      const url = take.storage_path.startsWith("public:")
        ? take.storage_path.slice("public:".length)
        : (await admin.storage.from("takes").createSignedUrl(take.storage_path, 60 * 60 * 3)).data?.signedUrl ?? null;
      if (url) { choreo = { kind: "file", url, bpm: video.bpm ?? null, count_start: take.count_start ?? null }; title = video.title; }
    }
  }
  if (!choreo) return json({ error: "There’s no choreo video here anymore." }, 404);
  let rows = admin.from("count_sheet_rows").select("id, section, counts, t_start, t_end").eq("project_id", project.id).not("t_start", "is", null);
  rows = project.choreo_youtube ? rows.is("video_id", null) : rows.eq("video_id", project.choreo_video_id);
  const { data: sections } = await rows;
  let owner: string | null = null;
  if (ps.allow_requests) {
    const { data: o } = await admin.from("project_members").select("user_id").eq("project_id", project.id).eq("role", "owner").limit(1).maybeSingle();
    if (o) owner = ((await admin.from("profiles").select("display_name").eq("id", o.user_id).maybeSingle()).data?.display_name ?? "").split(" ")[0] || null;
  }
  admin.from("practice_shares").update({ views: ps.views + 1 }).eq("token", ps.token).then(() => {});
  return json({
    kind: "practice",
    project: project.title,
    title,
    choreo,
    sections: (sections ?? []).map((r: any) => ({ id: r.id, section: r.section, counts: r.counts, t_start: Number(r.t_start), t_end: r.t_end === null ? null : Number(r.t_end) })),
    allow_requests: ps.allow_requests === true,
    owner,
    expires_at: ps.expires_at,
  });
}
