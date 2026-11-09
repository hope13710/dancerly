// classify-notes: gives each note one focus area (timing, technique, sync, formation, performance, other).
// Notes are read with the caller's own token, so row level security decides which ones they can ask about.
// Only notes without a category are classified, and the write is conditional, so a person's choice is never overwritten.
import Anthropic from "npm:@anthropic-ai/sdk@0.132.1";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const MODEL = "claude-haiku-5-5";
const MAX_NOTES = 40;
const CATEGORIES = ["timing", "technique", "sync", "formation", "performance", "other"] as const;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: { ref: { type: "string" }, category: { type: "string", enum: [...CATEGORIES] } },
        required: ["ref", "category"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

const SYSTEM = `You sort dance practice feedback notes into one focus area each. Notes may be in English or Korean, critical or praising.

Areas:
- timing: on the beat, early or late, accents, hits, rhythm, musicality, counts (박자, 늦음, 빠름, 액센트, 음악)
- technique: how a move is done: angles, lines, depth, extension, footwork, details, doing the wrong move or forgetting it (각도, 라인, 깊이, 디테일, 동작 틀림)
- sync: matching each other: the group not together, different heights or angles between members, someone off from the rest (합, 싱크, 칼군무, 서로 다름)
- formation: spacing, positions, lines of the formation, traffic and transitions between spots, stage use (동선, 대형, 간격, 자리, 위치)
- performance: facial expressions, energy, eye focus, confidence, character, stage presence (표정, 에너지, 시선, 자신감)
- other: anything else, or a note with no clear area (general praise like "great job", logistics, questions)

Rules:
- Pick the single area at the root of the note. If one member is late compared with the others, that is sync; if the whole group is late to the music, that is timing.
- Praise about a specific area gets that area ("spacing is even now" is formation).
- Return one result per input ref.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Your session ended. Log in again." }, 401);

  let body: { note_ids?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  const ids = Array.isArray(body.note_ids) ? [...new Set(body.note_ids.filter((x): x is string => typeof x === "string"))].slice(0, MAX_NOTES) : [];
  if (!ids.length) return json({ classified: [] });

  // Only notes this person can see, and only ones nobody has categorized yet.
  const { data: notes, error } = await asUser.from("notes").select("id, body").in("id", ids).is("category", null);
  if (error) return json({ error: error.message }, 500);
  if (!notes?.length) return json({ classified: [] });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "AI isn’t switched on yet." }, 503);
  const client = new Anthropic({ apiKey });
  const refs = notes.map((n, i) => ({ ref: `n${i + 1}`, id: n.id }));
  const input = notes.map((n, i) => `[n${i + 1}] ${String(n.body).slice(0, 600)}`).join("\n");

  // deno-lint-ignore no-explicit-any
  let response: any;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: "user", content: `Notes (${notes.length}):\n${input}` }],
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: "The AI is busy. Try again in a minute." }, 429);
    if (err instanceof Anthropic.APIError) return json({ error: `The AI couldn’t sort these notes (${err.status}).` }, 502);
    return json({ error: "Couldn’t reach the AI." }, 502);
  }
  if (response.stop_reason !== "end_turn") return json({ error: "The AI couldn’t sort these notes." }, 422);
  const text = response.content.find((b: { type: string }) => b.type === "text")?.text;
  let parsed: { results?: { ref: string; category: string }[] };
  try { parsed = JSON.parse(text ?? ""); } catch { return json({ error: "The AI returned something unreadable." }, 502); }

  const byRef = new Map(refs.map((r) => [r.ref, r.id]));
  const classified: { id: string; category: string }[] = [];
  for (const r of parsed.results ?? []) {
    const id = byRef.get(r.ref);
    if (!id || !(CATEGORIES as readonly string[]).includes(r.category)) continue;
    byRef.delete(r.ref); // one answer per note
    // Conditional write: if someone picked a category in the meantime, theirs stays.
    const { data: updated } = await admin.from("notes").update({ category: r.category, category_source: "ai" })
      .eq("id", id).is("category", null).select("id");
    if (updated?.length) classified.push({ id, category: r.category });
  }
  return json({ classified });
});
