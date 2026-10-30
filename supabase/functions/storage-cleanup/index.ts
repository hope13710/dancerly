// storage-cleanup: removes video and thumbnail files that no take points to any more (deleted videos, takes,
// and projects, and uploads that never got saved). Called every hour by pg_cron (migration 029).
// The list comes from storage_orphans(), which skips anything uploaded in the last 2 days.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  const { data: secret } = await admin.rpc("email_cron_secret");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return new Response("forbidden", { status: 403 });
  const { data: names, error } = await admin.rpc("storage_orphans", { p_limit: 500 });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  let removed = 0;
  for (let i = 0; i < (names ?? []).length; i += 100) {
    const batch = names.slice(i, i + 100);
    const { error: rmErr } = await admin.storage.from("takes").remove(batch);
    if (rmErr) console.error("remove", rmErr.message);
    else removed += batch.length;
  }
  return Response.json({ removed });
});
