# Looproom Product Build TODO

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

## Phase 2 — real SaaS foundations
- [ ] Add authentication and workspace membership using managed server/database services.
- [ ] Add persistent users, workspaces, groups, reviews, submissions, notes, replies, and notifications.
- [ ] Add private video storage, upload processing, signed playback URLs, and retention rules.
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
- [ ] Class / weekly / monthly reports built only from coach notes, with source-note citations validated server-side.
- [ ] Coach review before send; weekly digest email; auto-translation into each dancer's language.
- [ ] Coach briefing before class (top recurring issues, stalled dancers).

## Phase 3.5 — motion signals (opt-in beta)
- [ ] Pose estimation + beat detection: timing vs beat, extension, symmetry — compared only with the dancer's own previous takes.
- [ ] Guardian consent flow for minors before any motion analysis.

## Phase 3 — deeper dance workflow
- [ ] Add range notes and section looping.
- [x] Mirror mode toggle in the review player (button + `M` shortcut) and in the landing demo.
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
