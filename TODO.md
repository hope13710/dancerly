# Looproom Product Build TODO

Positioning: a feedback tool for **dance teams** — every member can give and receive notes; coaches are an optional role.

Planning docs: `docs/README.md` (menu structure, service structure, functional spec with feature IDs, user flows, UX/UI, policy).

## Landing page
- [x] English-first hero with “Give better dance feedback, right where it happens.” and `Start free` / `Watch how it works` CTAs.
- [x] Problem section, four-step workflow, Video Review product preview, coach/team benefits, privacy/trust, pricing preview, FAQ, final CTA, and footer.
- [x] Responsive desktop, tablet, and mobile layout.
- [x] Lightweight demo interaction for timestamp note selection, mobile menu, FAQ accordion, and signup form feedback.
- [x] Static build configuration, project logo metadata, and `/manus-routes.json`.

## MVP workspace — phase 1 front-end prototype
- [x] Responsive workspace shell at `/app` with workspace switcher and role-aware navigation.
- [x] Home with actionable review queue, pending submissions, activity feed, and activity-based metrics.
- [x] Reviews list with All / Needs review / Ready to close filters.
- [x] Video Review with timestamped notes, selected-note timeline state, version state, note composer demo, resolve action, and upload-video demo action.
- [x] Groups with member summary and invite-link copy action.
- [x] Inbox with unread state and mark-as-read behavior.
- [x] Progress with activity-based metrics, review activity chart, and focus areas.
- [x] Settings with workspace, notification, privacy, retention, and billing entry points.
- [x] Mobile navigation drawer and responsive review layout.
- [x] Clear front-end prototype boundary: seeded demo data is local to the browser; no real auth, database, storage, or billing yet.

## Prototype alignment with the planning docs
- [ ] Coach sidebar: Home · Inbox · Review queue · Projects · People · Insights · Settings (`docs/01-menu-structure.md`).
- [ ] Separate mobile dancer app at `/d` with bottom tabs: Today · Feedback · ＋ · Recap · Me.
- [ ] Workspace hierarchy Project › Video › Take (Request optional); note status Open → Practicing → Resolved.
- [ ] Raise app text to 12px minimum and unify tokens (`docs/05-ux-ui-design.md` §3).

## Phase 2 — real SaaS foundations
Setup notes: `docs/07-backend-setup.md`. Schema: `supabase/migrations/`.
- [x] Supabase auth: email + password, one-time email confirmation (code or link), forgot/reset password, Google button behind a flag, profile on first visit.
- [x] App shell: left sidebar on wide screens (＋ New, All projects, project list, account menu, hide toggle); bottom tab bar on phones (Projects · ＋ · Me) with the same actions. Review screen hides the tab bar.
- [x] Workspace menus (docs/01): Home (checklist, For you, recent activity), Inbox (notifications table + triggers, unread badge, realtime), Feedback (For me / By me / Team × To do / Resolved), People (+ profile), Insights (stats, left-vs-fixed chart, by video / by person), Settings (account, notification prefs, projects, plan), project tabs Videos · Notes · People · Settings (invite links, transfer ownership, remove, delete/leave). Deep links `?note=` open the review at that moment. Phones: Home · Feedback · ＋ · Projects · Me, bell → Inbox.
- [x] AI recaps: `generate-recap` Edge Function (RLS-scoped notes, cited items only, cache when nothing changed), Project › Recaps (All/Shared/Mine/Pinned, by week, earlier versions folded), recap page (citations → play the moment, pin, share → Inbox, regenerate, to-dos → Practicing), Me › My recaps, Home card. Needs `ANTHROPIC_API_KEY` secret. Not yet: streaming, weekly auto-recap, translation, per-sentence feedback, plan limits.
- [x] Requests: `create_request` / `remind_request` RPCs, Project › Requests (active/closed, submission rate), request page (brief, reference video, per-person status Not submitted/Overdue/Submitted/Reviewed/All fixed, remind once an hour, close/reopen/delete), submit or re-submit as the next take, Inbox kinds.
- [x] Review queue: `video_views` marks what you watched; Needs review / Re-submitted / Overdue, project filter, Start reviewing, Next video → (Shift+N) in the review.
- [x] Calendar: `project_events`; global and per-project, month grid and agenda, request due dates included, add/edit/delete, .ics export. Home shows Due from you / To review / Coming up.
- [x] ⌘K / Ctrl+K search palette (projects, people, videos, requests, notes, commands).
- [x] Groups (Project › People), requests to groups, weekly repeating requests, pg_cron job hourly: 24h-before due reminders + next week's repeat.
- [x] Project Overview (goal, music, show countdown, stats) and Count sheet (sections, counts, focus, reference moment, Learning/Practicing/Clean). Review opens at `?t=`.
- [x] Guest share link for a video (`/app/s/:token`, `shared-video` function, expiry, turn off) and calendar subscription feed (`calendar-feed` function, webcal).
- [x] Project Pages (Markdown docs, autosave, live preview, pin).
- [ ] Needs the owner's setup: email/push delivery (SMTP, VAPID keys), billing, leaked-password protection (Auth settings).
- [ ] Later: weekly auto-recap, recap translation, request announcement notes, per-sentence recap feedback.
- [x] Projects with Owner/Member, invite links (`/app/join/:code`), member list, leave/remove, rename/delete.
- [x] Videos and takes (auto-numbered), private `takes` bucket, signed playback URLs.
- [x] Review: notes on a moment or range, @mentions of project members, 👍 agree, practicing/resolve rules, loop, mirror, take summary, live updates.
- [x] Row level security on every table, tested with three simulated users.
- [ ] Configure Site URL / redirect URLs and Google in the Supabase dashboard (see docs/07).
- [ ] Custom SMTP before launch; resumable uploads (tus) with progress; HLS transcoding and thumbnails.
- [ ] Mention notifications, Inbox, retention rules.
- [x] Takes stay in the data but show only when a video has 2+ takes; upload suggests stacking onto a matching video.
- [x] Merge a video into another as its next takes, notes included ("Merge into…" on the review screen; creator or owner).
- [ ] Add real email/in-app notifications and permission checks.
- [ ] Add Stripe plan entitlements and billing portal.
- [ ] Replace seeded demo data with database-backed queries and mutations.

## Phase 2.5 — projects and progress dashboard
See `docs/product-plan.md` for the full spec.
- [x] Landing: Projects, Progress dashboard, AI reports, and "gets better the longer you coach" sections.
- [ ] Projects: templates, count sheet (BPM → eight-count grid on the timeline), review board, pages with @links to notes.
- [ ] Dashboard: practice signals (submissions, loops, practice time) and feedback signals (notes by category, takes to fix, recurring corrections).
- [ ] Correction library: save and reuse frequent notes with `/`.

## Phase 3 — AI reports
- [x] Landing: one AI Recap with Just me / Whole project scopes (coach reports removed), auto-saved with 📌 pin and earlier recaps.
- [ ] Project › Recaps tab, Home recap card, Me › My recaps; version folding for the same scope and period.
- [x] Take summary on the review screen ("Take 3 · n resolved since Take 2 · n still open"), computed from note states.
- [ ] Recap Video filter (optional) on top of project × period.
- [ ] Dancer self-serve "My recap": period × coach/project × category, private by default, share with coach, checklist → note status Practicing.
- [ ] Class / weekly / monthly reports built only from coach notes, with source-note citations validated server-side.
- [ ] Coach review before send; weekly digest email; auto-translation into each dancer's language.
- [ ] Coach briefing before class (top recurring issues, stalled dancers).

## Phase 3.5 — motion signals (opt-in beta)
- [ ] Pose estimation + beat detection: timing vs beat, extension, symmetry — compared only with the dancer's own previous takes.
- [ ] Guardian consent flow for minors before any motion analysis.

## Phase 3 — deeper dance workflow
- [ ] Add range notes and section looping.
- [x] Mirror mode toggle in the review player (button + `M` shortcut) and in the landing demo.
- [x] Review screen prototype: notes need no label (AI labels them in reports/dashboard), click a note or the timeline to jump, range notes via Start/End or `[` `]`, "Loop this part", @mentions limited to people on the project, keyboard shortcuts.
- [ ] Persist notes, mentions and AI labels in the database; send mention notifications; let coaches correct an AI label from reports.
- [ ] Drag on the timeline to mark a range.
- [x] Team model on the landing page: rehearsal run-through demo with peer notes, @mention, 👍 agree, Team plan.
- [ ] Workspace roles Owner (방장) · Member only; Team / Private take visibility; 👍 agree and note hiding by the owner.
- [ ] One app for everyone (sidebar on desktop, bottom tabs on phones) instead of separate coach/dancer apps.
- [x] Landing demo shows sketch feedback attached to a note (step 02).
- [ ] Real sketch tool in the workspace: draw on the paused frame and save the sketch with the note.
- [ ] Mirror mode on real uploaded video (`<video>` with `scaleX(-1)`), remembered per viewer.
- [ ] Add frame stepping.
- [ ] Add version history and comparison.
- [ ] Add custom note categories and review templates.
- [ ] Add coach review queue filters and weekly email digest.

## Phase 4 — optional talent layer
- [ ] Add opt-in profiles and selected-video portfolios.
- [ ] Add expiring share links and view history.
- [ ] Validate verified partner discovery separately from the private coaching workflow.
