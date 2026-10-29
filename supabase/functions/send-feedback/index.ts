// send-feedback: saves a Help & feedback message, then copies it to the Notion inbox ("앱 의견함").
// The message is always saved first; if Notion is down or not connected yet, it stays in app_feedback
// (notion_page_id empty) and nothing is lost.
// Secrets: NOTION_TOKEN (an internal integration connected to the inbox database).
// NOTION_FEEDBACK_DB overrides the inbox database id.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const NOTION_DB = Deno.env.get("NOTION_FEEDBACK_DB") ?? "4f2cfbf66299449d9d632afc3be69e3d";
const KINDS: Record<string, string> = { bug: "Bug", idea: "Idea", question: "Question", other: "Other" };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : null);
// Notion text values hold at most 2000 characters each.
const text = (s: string) => (s.match(/[\s\S]{1,2000}/g) ?? [""]).slice(0, 3).map((content) => ({ text: { content } }));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Your session ended. Log in again." }, 401);
  const user = userData.user;

  let body: { kind?: string; body?: string; page?: string; user_agent?: string; lang?: string };
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  const kind = KINDS[body.kind ?? ""] ? body.kind! : "other";
  const message = (body.body ?? "").trim().slice(0, 4000);
  if (!message) return json({ error: "Write a message first." }, 400);
  const row = { user_id: user.id, kind, body: message, page: clip(body.page, 500), user_agent: clip(body.user_agent, 500), lang: clip(body.lang, 10) };

  const { data: saved, error: saveErr } = await admin.from("app_feedback").insert(row).select("id, created_at").single();
  if (saveErr) return json({ error: saveErr.message }, 500);

  // ---------- Copy to Notion (best effort) ----------
  // This message, plus any earlier ones that didn't make it (Notion down, not connected yet), oldest first.
  const token = Deno.env.get("NOTION_TOKEN");
  if (!token) return json({ ok: true, id: saved.id, notion: false });
  const { data: pending } = await admin.from("app_feedback").select("id, user_id, kind, body, page, user_agent, lang, created_at")
    .is("notion_page_id", null).order("id", { ascending: true }).limit(10);
  let notion = false;
  for (const fb of pending ?? []) {
    const ok = await toNotion(admin, token, fb);
    if (fb.id === saved.id) notion = ok;
    if (!ok) break; // Notion is unhappy: leave the rest for next time
  }
  return json({ ok: true, id: saved.id, notion });
});

// deno-lint-ignore no-explicit-any
async function toNotion(admin: any, token: string, fb: any): Promise<boolean> {
  const [{ data: profile }, { data: account }] = await Promise.all([
    admin.from("profiles").select("display_name").eq("id", fb.user_id).maybeSingle(),
    fb.user_id ? admin.auth.admin.getUserById(fb.user_id) : Promise.resolve({ data: null }),
  ]);
  const email = account?.user?.email;
  const title = fb.body.replace(/\s+/g, " ").slice(0, 80) + (fb.body.length > 80 ? "…" : "");
  const properties: Record<string, unknown> = {
    Message: { title: [{ text: { content: title } }] },
    Kind: { select: { name: KINDS[fb.kind] ?? "Other" } },
    Status: { status: { name: "New" } },
    "Full message": { rich_text: text(fb.body) },
    Name: { rich_text: text(profile?.display_name ?? "") },
    Page: { rich_text: text(fb.page ?? "") },
    Browser: { rich_text: text(fb.user_agent ?? "") },
    "Sent at": { date: { start: fb.created_at } },
    "Feedback ID": { number: fb.id },
  };
  if (email) properties.Email = { email };
  if (fb.lang === "en" || fb.lang === "ko") properties.Language = { select: { name: fb.lang } };
  try {
    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
      body: JSON.stringify({ parent: { database_id: NOTION_DB }, properties }),
    });
    if (!res.ok) {
      console.error("notion", res.status, (await res.text()).slice(0, 300));
      return false;
    }
    const page = await res.json();
    await admin.from("app_feedback").update({ notion_page_id: page.id }).eq("id", fb.id);
    return true;
  } catch (e) {
    console.error("notion", String(e).slice(0, 300));
    return false;
  }
}
