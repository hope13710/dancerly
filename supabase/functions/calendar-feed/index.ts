// calendar-feed: a private iCalendar URL for Google/Apple/Outlook calendars.
// The token in the URL is the only key; people can turn a feed off in Settings.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const text = (t: unknown) => String(t ?? "").replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");
// Lines longer than 75 octets must be folded (RFC 5545).
const fold = (line: string) => line.length <= 74 ? line : line.match(/.{1,73}/g)!.join("\r\n ");

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[0-9a-f]{36}$/.test(token)) return new Response("Not found", { status: 404 });
  const { data: feed } = await admin.from("calendar_feeds").select("user_id").eq("token", token).maybeSingle();
  if (!feed) return new Response("This calendar link was turned off.", { status: 404 });
  admin.from("calendar_feeds").update({ last_used_at: new Date().toISOString() }).eq("token", token).then(() => {});

  const { data: memberships } = await admin.from("project_members").select("project_id, projects(title)").eq("user_id", feed.user_id);
  const ids = (memberships ?? []).map((m: { project_id: string }) => m.project_id);
  const title = Object.fromEntries((memberships ?? []).map((m: { project_id: string; projects: { title: string } | null }) => [m.project_id, m.projects?.title ?? ""]));
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const [{ data: events }, { data: requests }] = ids.length ? await Promise.all([
    admin.from("project_events").select("id, project_id, title, kind, starts_at, ends_at, location, details, created_at").in("project_id", ids).gte("starts_at", since),
    admin.from("requests").select("id, project_id, title, due_at, created_at").in("project_id", ids).eq("status", "active").not("due_at", "is", null),
  ]) : [{ data: [] }, { data: [] }];

  const now = stamp(new Date().toISOString());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//dancerly//Calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:dancerly", "REFRESH-INTERVAL;VALUE=DURATION:PT1H"];
  for (const e of events ?? []) {
    const end = e.ends_at ?? new Date(new Date(e.starts_at).getTime() + 60 * 6e4).toISOString();
    lines.push("BEGIN:VEVENT", `UID:event-${e.id}@looproom`, `DTSTAMP:${now}`, `DTSTART:${stamp(e.starts_at)}`, `DTEND:${stamp(end)}`,
      `SUMMARY:${text(e.title)}`, ...(e.location ? [`LOCATION:${text(e.location)}`] : []),
      `DESCRIPTION:${text(`${title[e.project_id]}${e.details ? `\n${e.details}` : ""}`)}`, `CATEGORIES:${text(e.kind)}`, "END:VEVENT");
  }
  for (const r of requests ?? []) {
    lines.push("BEGIN:VEVENT", `UID:due-${r.id}@looproom`, `DTSTAMP:${now}`, `DTSTART:${stamp(r.due_at)}`, `DTEND:${stamp(new Date(new Date(r.due_at).getTime() + 15 * 6e4).toISOString())}`,
      `SUMMARY:${text(`Due: ${r.title}`)}`, `DESCRIPTION:${text(title[r.project_id])}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.map(fold).join("\r\n"), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=900" },
  });
});
