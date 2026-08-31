# A — Organizer dashboard: inventory of unbuilt and partly-built screens

**Audited 2026-08-30** against the working tree at `apps/organizer/`. Read-only audit; no
source file was modified.

---

## Summary

The dashboard has **175 route files** under `apps/organizer/src/app/(dash)/` — 173 nav leaf
screens, plus the `[...slug]` catch-all and the `session-manager/[id]` detail route. **126 files
carry a gap component** (129 `GapPanel`, 8 `NotBuilt` cards, 8 `GapTag` header tags = 145 gap
notes), and because seven of those files are shared screen components reused across audiences,
**143 of the 175 routes render at least one gap note**. Only **34 routes reach a `'use server'`
action of any kind**; 25 of those 34 *also* carry a gap note, so **141 of 175 routes cannot write
anything at all**. Across the whole `(dash)` tree there are **48 server actions in 24 action
modules**, and exactly **one deletes an entity** (`deleteQuestionAction`); two others release a
relationship (`removeAttendeeAction`, `releaseBoothAction`). No screen offers create + edit +
delete of its primary entity except the three question-form screens. **40 routes execute zero
Firestore reads** (their only `await` is `requireOrganizer()`), which contradicts the claim in
`ROADMAP.md` and `apps/organizer/README.md` that "all 173 screens read or write real Firestore
data"; those 40 are honest prose-and-static-table screens, but they are not data screens. The
codebase is unusually clean otherwise: **zero `TODO`/`FIXME` markers**, one `readOnly` input
(`engagement/speed-networking/page.tsx:164`, an intentional display field), and every `<form>` on a
non-writing screen is a `method="get"` filter toolbar rather than an unwired submit. Two real
defects surfaced outside the gap notes: **36 hard-`disabled` buttons and menu items** across eight
screens (Session Manager, Speaker Manager, Sponsor Manager, Attendees, Check-in, Announcements,
Basics, layout) that render as clickable-looking chrome in a demo, and **`(dash)/layout.tsx:149,154`
hard-codes `http://localhost:8081` and `http://localhost:3000/tickets`** in the Preview dropdown
while every other cross-app link uses `WEB_PUBLIC_ORIGIN` (default `:3200`) — both links are dead
on the deployed Netlify site.

**Classification key**

| Label | Meaning |
|---|---|
| **CRUD** | Can create, edit and delete through a server action |
| **CRUD−** | Writes (create/update and/or a status toggle) but cannot delete |
| **READ-ONLY** | Renders real Firestore data; no mutation path |
| **INERT** | Renders, but offers nothing to act on — static prose/tables, no data read, or every action disabled |

**Effort key** — S ≤ 2 days · M 3–8 days · L > 8 days, or blocked on infrastructure/a product
decision. Sizes quoted from a `NotBuilt` card are marked *(stated)*.

**File paths** in the table are relative to
`/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/apps/organizer/src/app/(dash)/`.

---

## The table

### Attendees

| Route | File | Classification | What is missing | Effort |
|---|---|---|---|---|
| /attendees/admin-settings | `attendees/admin-settings/page.tsx` (gap :113) | CRUD− | Saves the settings doc. Missing: adding/removing an admin (env var + redeploy by design), any role beyond one level (a check-in-only operator has no second level), enforcement of the attendee switches (People tab is unconditional; directory visibility is the attendee's own `visibleInDirectory`). | M |
| /attendees/call-for-volunteers/release-and-consent-forms | `attendees/call-for-volunteers/release-and-consent-forms/page.tsx` (gap :87, NotBuilt :80, GapTag :30) | INERT | Everything. No form published, no signature stored, no volunteer record to hold one; no shift blocking; no expiry/renewal. Needs a volunteer+shift model, a submission/response store and an append-only versioned consent record. *(stated: 8–10 days with the volunteer manager, neither useful alone)* | L |
| /attendees/call-for-volunteers/volunteer-manager | `attendees/call-for-volunteers/volunteer-manager/page.tsx` (gap :92, NotBuilt :85, GapTag :32) | INERT | No volunteer is stored, listed, assigned or contacted. No volunteer check-in (the door scanner has no concept of a shift). Needs a `shifts` collection keyed to registrations, a public submission form and roster views. *(stated: 5–7 days, half of it the shared submission form)* | M |
| /attendees/categories | `attendees/categories/page.tsx` (gap :320) | READ-ONLY (GET filter form only) | Cannot create a category — `Role` is a closed six-value union in `models.ts`. Cannot assign one (needs a trusted server minting the roles claim in the same write, or mirror/token drift). Categories do nothing: badge printing is modelled and unwritten, announcements have no audience filter, per-person session access is not modelled. Bulk import writes the mirror only. | M |
| /attendees/certificates | `attendees/certificates/page.tsx` (gap :121, NotBuilt :114, GapTag :47) | INERT | No session-level attendance to name hours from, no template store, no PDF renderer, no bulk send/resend queue with per-recipient status, no self-serve download (`checkIns` has no client rule). *(stated: 4–6 days, mostly renderer + retry)* | M |
| /attendees/check-in-and-checkout/check-in | `attendees/check-in-and-checkout/check-in/page.tsx` (gap :266) | CRUD− (the strongest write path in the app) | Missing: day/session scope UI (engine supports it — each scope is another `checkInLists` doc), badge printing on scan (`badgeTemplates`/`badgePrintJobs` modelled and inert), checkout. Both CSV export menu items are hard-disabled at `:96–97` although the export registry already serves six CSVs. Self check-in is a deliberate refusal (`firestore.rules` denies client writes). | S–M |
| /attendees/check-in-and-checkout/checkout | `attendees/check-in-and-checkout/checkout/page.tsx` (gap :90, NotBuilt :83, GapTag :38) | INERT | Nothing on the page writes. No exits, so no live occupancy and no re-entry history — `checkIns/{registrationId}` makes a second arrival an already-exists failure by design. Needs an append-only movement log beside `checkIns` and a direction on the scanner. *(stated: 2–3 days for the write path)* | S |
| /attendees/check-in-and-checkout/kiosk-check-in | `attendees/check-in-and-checkout/kiosk-check-in/page.tsx` (gap :106, NotBuilt :99, GapTag :36) | INERT | No unattended check-in of any kind, no kiosk activity dashboard (raw material exists — `scanEvents` names the device), no on-demand badge printing. Needs a stripped-down unattended client plus a local print agent, because ZPL over a raw socket is unreachable from a browser. *(stated: 5–8 days, printer half is most of it)* | M |
| /attendees/check-in-and-checkout/self-check-in | `attendees/check-in-and-checkout/self-check-in/page.tsx` (gap :98, NotBuilt :91, GapTag :43) | INERT | No self-check-in URL, no printable QR poster, no rate limiting/abuse controls on a public endpoint. Needs a trusted-server route and a decision about whether an unwitnessed scan counts as attendance. *(stated: ~2 days once the decision is made)* | S (blocked on a decision) |
| /attendees/check-in-and-checkout/session-self-check-in | `attendees/check-in-and-checkout/session-self-check-in/page.tsx` (gap :116, NotBuilt :109, GapTag :42) | INERT | No per-session attendance, so no session-level reporting and no capacity enforcement at a room door. Needs an auto-created/auto-selected per-session check-in list plus the same trusted-server self-scan route. *(stated: 1–2 days for session scope + ~2 days for the self-scan route)* | S–M |
| /attendees/integrations/constant-contact | `attendees/integrations/constant-contact/page.tsx` | INERT (documentation, no data read) | No integration exists. `IntegrationGuide` prose telling the organizer to export a CSV and import it manually. *(page states 2–4 days)* | M |
| /attendees/integrations/crm-integration-via-zapier | `attendees/integrations/crm-integration-via-zapier/page.tsx` | INERT (documentation, no data read) | No Zapier trigger, no outbound webhook. A single outbound webhook on fulfilment would subsume most of this list. | S |
| /attendees/integrations/mailchimp | `attendees/integrations/mailchimp/page.tsx` | INERT (documentation, no data read) | No audience sync. Manual CSV round-trip only. | M |
| /attendees/manage-attendees/analytics-and-exports | `attendees/manage-attendees/analytics-and-exports/page.tsx` (gap :159) | READ-ONLY (+ 6 working CSV downloads via `/export/[kind]`) | No session-level attendance (needs per-session check-in), no engagement scores/leaderboards (need Cloud Function counters — Spark plan), no cross-event reporting (one event). | M |
| /attendees/manage-attendees/attendee-limit-upgrade | `attendees/manage-attendees/attendee-limit-upgrade/page.tsx` (gap :84) | READ-ONLY | No billing, no plan, no invoice, no payment form for the dashboard itself; no metered attendee cap (not modelled, not planned); no Firestore quota usage alerts (cheap — a scheduled job on either trusted server). | S (alerts) / N/A (billing) |
| /attendees/manage-attendees/attendees | `attendees/manage-attendees/attendees/page.tsx` (gap :319) | CRUD− (import only) | CSV import works (preview + commit, upsert on email, calls the same `ensureRegistration` as the Stripe webhook). Missing: manual column mapper for unmatched headers; 24-hour Eventbrite/RegFox sync; **add/edit an attendee** — `:148` is a hard-disabled button, `:283`/`:285` are disabled "Edit attendee"/"Remove from event" menu items; Categories and Segments (blocked on Question Forms). | M |
| /attendees/manage-attendees/cross-event-report | `attendees/manage-attendees/cross-event-report/page.tsx` (gap :103) | READ-ONLY | No cross-event figure — one event. `EVENT_ID` is a compile-time constant, so an event switcher is a code change; importing a past event merges two years into one list without a runtime `eventId` first. | M |
| /attendees/manage-attendees/hybrid-settings | `attendees/manage-attendees/hybrid-settings/page.tsx` (gap :93) | READ-ONLY | Nothing on the page stores a value because no field exists to control. The Audience column is hard-coded to "In Person". | M (needs the virtual/hybrid model) |
| /attendees/name-badges | `attendees/name-badges/page.tsx` (gap :256) | READ-ONLY (+ `window.print()` at `print-button.tsx:14`) | No badge designer (one fixed template; `badgeTemplates` holds raw ZPL a browser cannot emit, so a designer must produce both paths or they drift). No print-on-demand at check-in (`badgePrintJobs` inert; a hall printer needs a driver the browser cannot reach). No sign-in code on the badge (deliberate — `claimCode` + QR on one card makes a photograph a sign-in). No sheet alignment for pre-cut stock. | M |
| /attendees/release-and-consent-forms | `attendees/release-and-consent-forms/page.tsx` (gap :90, NotBuilt :83, GapTag :32) | INERT (no data read) | No consent collected, no signed/unsigned status, no reminders. Directory opt-out is explicitly *not* consent. Needs a question/response store, an append-only versioned consent record and a reminder sender. *(stated: 3–5 days on top of Question Forms, the prerequisite)* | M |
| /attendees/segments | `attendees/segments/page.tsx` (gap :416) | READ-ONLY (GET filter form only) | Segments from registration answers do not exist — needs Question Forms first *(stated: 6–9 days forms + 3–4 days segments)*. No segment object in `models.ts`; every group shown is a filter evaluated per request and discarded. No send-to-segment (announcements have no audience field). No segment on the badge or at the door. No add-on purchases to segment by. | L |
| /attendees/session-cap | `attendees/session-cap/page.tsx` (gap :333) | READ-ONLY (GET filter form only) | No registration against a cap — a saved session today is a bookmark in the attendee's own subcollection, not a seat claim. No seats-taken/close-when-full, no waitlist, no session check-in against the cap. Editing the cap belongs on Session Manager beside the room; this screen only reads. | M |
| /attendees/ticket-session-mapping | `attendees/ticket-session-mapping/page.tsx` (gap :285) | READ-ONLY | No grant matrix on the ticket type and no UI to edit one; no enforcement anywhere (`users/{uid}/entitlements` is modelled and never written); no video library to grant; no add-ons. **Both booleans are uneditable from anywhere** — the Create Tickets form has no control and its action writes `false` for a new tier, so a tier created in this dashboard can never include workshops. | M |

### Content

| Route | File | Classification | What is missing | Effort |
|---|---|---|---|---|
| /content/agenda-center/conflict-check | `content/agenda-center/conflict-check/page.tsx` | READ-ONLY | Detects five conflict classes from data Session Manager already loads. No custom rules, no resolve-from-here action. (No gap note — the honest remainder is small.) | S |
| /content/agenda-center/session-manager | `content/agenda-center/session-manager/page.tsx` (gap :308) | READ-ONLY (list) — six hard-disabled buttons at `:201,204,207,211,235,291` | No agenda import/export (Whova's Excel round-trip; research puts a round-trippable importer with stable IDs at 6–9 days and calls that estimate 3× optimistic). No add session, no sub-sessions or non-session items (`SessionDoc` has `seriesId` but no parent link, so no time cascade). No bulk edit / block move / swap, no neighbour-aware prompts. No notification that a session moved (`roomChangePush()` is the wired seam). | L |
| /content/agenda-center/session-manager/[id] | `content/agenda-center/session-manager/[id]/page.tsx` | CRUD− | Edits one session via `saveSessionAction`. No create, no delete. No cap field, no stream field, no sponsored flag, no "may be recorded" flag. | S |
| /content/agenda-center/session-qanda-manager | `content/agenda-center/session-qanda-manager/page.tsx` | CRUD− | Settings + moderation write. Upvote counts never move — the counter trigger is written in `functions/` and not deployed (Blaze). | S (after deploy) |
| /content/agenda-center/track-manager | `content/agenda-center/track-manager/page.tsx` (gap :113) | READ-ONLY | Cannot create, rename, recolour or delete a track. Cheap to build, expensive to get wrong: `SessionDoc` caches `primaryTrackName`/`primaryTrackColor`, so a rename needs a fan-out across every cross-listing session. | M |
| /content/artifact-center-poster-pitch-gallery/artifact-manager | `content/artifact-center-poster-pitch-gallery/artifact-manager/page.tsx` (gap :100) | INERT | Nothing stores an artifact. No presenter self-service upload (the capability-link pattern exists once, for order confirmations, and is not generalised). No board numbering — same missing floor plan as booth selection. | M |
| /content/artifact-center-poster-pitch-gallery/artifact-streaming | `content/artifact-center-poster-pitch-gallery/artifact-streaming/page.tsx` (gap :57) | INERT (no data read) | No artifacts collection. No video anywhere — no streaming, hosting, recording or player. `TicketTypeDoc.includesVideoLibrary` is sold on two tiers and served by nothing. No scheduled slots. | L |
| /content/artifact-center-poster-pitch-gallery/competition | `content/artifact-center-poster-pitch-gallery/competition/page.tsx` (gap :81) | INERT (no data read) | No artifacts, votes, judges or leaderboard. Live tallies generally do not move (same trigger-deployment blocker as Q&A and polls). | M |
| /content/artifact-center-poster-pitch-gallery/message-presenters | `content/artifact-center-poster-pitch-gallery/message-presenters/page.tsx` (gap :67) | INERT (no data read) | No presenters collection, no addresses, no compose box, no sent history for this audience. | S (once presenters exist) |
| /content/basics | `content/basics/page.tsx` (gap :140) | READ-ONLY — hard-disabled edit button at `:56` ("Read-only — see below") | The event's identity is compile-time constants in `@kgc/shared`; nothing here writes. Whova's Basics also carries Project Management with external non-admin team members — a separate product surface with its own login, sequenced after the demo. | M |
| /content/branding-center/app-branding | `content/branding-center/app-branding/page.tsx` (gap :96) | CRUD− (saves a settings doc nothing reads) | **Nothing applies the colour** — not the app, not `apps/web`, not this dashboard's own chrome. No logo/banner/header upload (no file-upload UI exists anywhere in the project). No preview. No contrast checking. | M |
| /content/branding-center/branded-event-url | `content/branding-center/branded-event-url/page.tsx` (gap :66) | CRUD− (saves a slug nothing serves) | `apps/web` has no `/[slug]` segment, so the reserved word 404s. No subdomain (DNS + certificate). No uniqueness check. No deep link into the app (needs associated-domains + intent filter + a development build). | S (the route) |
| /content/branding-center/customize-resources | `content/branding-center/customize-resources/page.tsx` (gap :82) | READ-ONLY | Cannot rename, hide or reorder a tab (native tab order is fixed by JSX child order on SDK 54). Cannot add a menu item (route + two icons + a release). No per-language labels — the app has no i18n layer at all. | M |
| /content/branding-center/web-app-speaker-page | `content/branding-center/web-app-speaker-page/page.tsx` (gap :87) | READ-ONLY | No browser client for attendees — "the largest missing piece by an order of magnitude", a second implementation of the whole event app. No layout choices. No featured/ordering field on `SpeakerDoc` (that one is cheap). No branding. | L |
| /content/call-for-speakers-abstracts | `content/call-for-speakers-abstracts/page.tsx` (gap :107) | READ-ONLY | No submissions collection, reviewer role, public form or decision workflow. `npm run import:whova` stands in and starts *after* every decision. Anonymous review is the requirement that forces a rewrite if added late. | L |
| /content/documents-and-videos/attendee-video-access | `content/documents-and-videos/attendee-video-access/page.tsx` (gap :74) | READ-ONLY | Cannot grant or revoke per attendee — `users/{uid}/entitlements` is modelled and never written. No expiry date ("three months" is copy on a ticket). No player. | M |
| /content/documents-and-videos/documents | `content/documents-and-videos/documents/page.tsx` (gap :135) | READ-ONLY | **No file upload** — the single biggest gap; Storage rules exist, a picker/size limit/type check/progress bar do not. No real access control (links stay public; needs signed URLs, which needs the files to be ours). No download counts. | M |
| /content/documents-and-videos/video-hosting | `content/documents-and-videos/video-hosting/page.tsx` | INERT (documentation, no data read) | No hosting, transcoding or entitled playback. Argued as a bill and an operational commitment rather than a screen — the recommendation is Mux/Cloudflare Stream/unlisted Vimeo with this screen holding ids. | L |
| /content/exhibitor-center/exhibitor-manager | `content/exhibitor-center/exhibitor-manager/page.tsx` (gap :249) | CRUD− | Saves and sets status. Missing: lead scanning (the commercial reason a booth is bought — exhibitors have no `leads` subcollection, and the app has no scanner for either audience); exhibitor staff tickets; booth self-selection (no floor plan); logo upload (`logoURL` exists, nothing writes a file). | M |
| /content/exhibitor-center/exhibitor-trivia | `content/exhibitor-center/exhibitor-trivia/page.tsx` | INERT (documentation, no data read) | Everything the passport contest needs plus an exhibitor-authored question bank, which needs an exhibitor-facing login — a second auth surface with its own rules, recovery flow and attack surface. Listed as a candidate to cut. | L |
| /content/exhibitor-center/message-exhibitors | `content/exhibitor-center/message-exhibitors/page.tsx` (gap :139) | READ-ONLY | No compose box, no send, no sent history for exhibitors (~a day's work — the bulk sender exists for speakers/sponsors). No booth-staff mail (one contact per company, no staff records). No scheduling (deliberately absent everywhere). | S |
| /content/exhibitor-center/outreach-campaigns | `content/exhibitor-center/outreach-campaigns/page.tsx` (gap :75) | READ-ONLY | No prospect records — `ExhibitorDoc` describes a company that has already booked. No directory to prospect from. No open/click tracking or unsubscribes (`emailLog` records delivery outcomes only). | M |
| /content/exhibitor-center/passport-contest | `content/exhibitor-center/passport-contest/page.tsx` | INERT (documentation, no data read) | No booth-side scan path, no passport, no stamps, no prize redemption. | M |
| /content/fair-center/fair-manager | `content/fair-center/fair-manager/page.tsx` (gap :91) | INERT | Postings, applications and interviews are none of them modelled. Employer accounts do not exist (exhibitors have no login). No lead capture — `sponsors/{id}/leads` is modelled, exhibitors have nothing, and no scanner writes to either. | L |
| /content/logistics-center | `content/logistics-center/page.tsx` (gap :108) | READ-ONLY | No editable logistics field at all — no venue notes, wifi, parking or shuttle times. No venue map (same missing floor plan; no image upload anywhere). No emergency information (the one item that would matter at 3pm on day two). | M |
| /content/project-management/message-team-members | `content/project-management/message-team-members/page.tsx` (gap :117) | READ-ONLY | No compose box, no send, no history. No team accounts — dashboard access is a claim checked by `requireOrganizer`, and no screen lists or grants it. One role only. Assignees are never notified. | S |
| /content/project-management/projects-and-checklists | `content/project-management/projects-and-checklists/page.tsx` (gap :235) | CRUD− | Saves and advances tasks. Missing: starter templates (content, not code); reminders (an overdue task shows here and nowhere else; assignees are free text with no address); dependencies between tasks (`blocked` is a status, not a link). | S |
| /content/speaker-center/message-speakers | `content/speaker-center/message-speakers/page.tsx` | CRUD− (bulk send, works) | No scheduling, no templates, no per-recipient resend. | S |
| /content/speaker-center/release-and-consent-forms | `content/speaker-center/release-and-consent-forms/page.tsx` (gap :98) | READ-ONLY | Nothing captures, stores or verifies a signature. `SessionDoc` has no "may be recorded" flag, so the app cannot hide a recording it is not allowed to show. Attendee consent is unasked (Question Forms unbuilt). | M |
| /content/speaker-center/speaker-manager | `content/speaker-center/speaker-manager/page.tsx` (gap :222) | READ-ONLY (GET filter form) — nine hard-disabled controls at `:125,126,129,132,141,142,143,212,213,214` | No speaker self-service form (Whova's real permission model — a personal link per speaker plus a reminder schedule; needs an email sender, which now exists). No add/edit speaker (created by the importer; an editor must not break the `speakers`↔`users` join on `userId`). No release/consent forms. | M |
| /content/sponsor-center/advanced-banners | `content/sponsor-center/advanced-banners/page.tsx` (gap :198) | READ-ONLY | No banner surface in the app (an app change, not a dashboard one). No uploaded banner artwork (Storage blocker; the logo is a square wordmark, not a banner). No impression/click counting (needs a write per view or an aggregate trigger — Blaze). No sponsored-session placement; nothing marks a session as sponsored. | M |
| /content/sponsor-center/message-sponsors | `content/sponsor-center/message-sponsors/page.tsx` | CRUD− (bulk send, works) | No scheduling, no templates, no per-recipient resend. | S |
| /content/sponsor-center/outreach-campaigns | `content/sponsor-center/outreach-campaigns/page.tsx` (gap :89) | READ-ONLY | No prospect records (`SponsorDoc` describes a signed sponsor). No pipeline — no status, owner, next-contact date or notes. No open/click tracking. No unsubscribe handling — legally required for cold mail in most of the world. | M |
| /content/sponsor-center/sponsor-manager | `content/sponsor-center/sponsor-manager/page.tsx` (gap :222) | READ-ONLY — seven hard-disabled controls at `:54,55,184,187,190,199,200` | Cannot create a tier (`SponsorTier` is a four-value union in `models.ts`). No sponsor self-service portal. No banners or sponsored sessions to place. No lead retrieval — `sponsors/{id}/leads` is modelled and empty, though the badge QR that would feed it already works. | M |
| /content/sponsor-center/sponsor-tiering | `content/sponsor-center/sponsor-tiering/page.tsx` (gap :148) | READ-ONLY | Cannot add, rename, reorder or delete a tier (all four are `models.ts` edits). Cannot move a sponsor between tiers (set by the importer). No benefit model, so nothing can be checked off. Placement weights are printed, not applied. | M |

### Engagement

| Route | File | Classification | What is missing | Effort |
|---|---|---|---|---|
| /engagement/1-1-meeting-scheduler | `engagement/1-1-meeting-scheduler/page.tsx` + `engagement/gathering-screen.tsx` (gap :301) | CRUD− | Organizer-side placement works. Missing: any attendee surface (no browse, join or request); placements are free text, not accounts, so nothing joins a placement to a registration; no request-and-accept flow (needs an availability model — free-text "afternoons are fine" is not schedulable); no `.ics` export; no check against a person's own schedule. | M |
| /engagement/announcement-wall/activity-stream-webpage | `engagement/announcement-wall/activity-stream-webpage/page.tsx` (gap :111) | READ-ONLY | The wall page itself does not exist — a route in `apps/web` reading `announcements`, styled for a room. "The smallest genuinely public thing left on this tab." No auto-refresh (every `apps/web` page is server-rendered per request). No pinning or expiry on `AnnouncementDoc`. No images in an announcement. | S |
| /engagement/announcements | `engagement/announcements/page.tsx` (gap :152) | CRUD− (the one screen that writes and pushes) | No recipient targeting with a live count (needs categories/segments → registration answers). No email delivery with Whova's three-way setting (needs a provider with a verified sending domain — ~2 days). No drafts, scheduled send or test send. No sender identity. Four hard-disabled controls at `:72,78,80,143,144`. | M |
| /engagement/community/attendee-matchmaking | `engagement/community/attendee-matchmaking/page.tsx` (gap :137) | READ-ONLY | No suggestions in the app (deliberate — would use profiles of people who opted out of being findable). No matching on registration answers or stated goals (Question Forms unbuilt). No 1-1 scheduling (needs availability, which nothing collects). | M |
| /engagement/community/discussion-topics | `engagement/community/discussion-topics/page.tsx` + `engagement/community/category-screen.tsx` (gap :91) | READ-ONLY | Organizers cannot post at all. No seeded topics (the thing that stops an empty board on day one). No pinning. No per-topic reply notifications. | S |
| /engagement/community/meet-ups | `engagement/community/meet-ups/page.tsx` + `category-screen.tsx` (gap :91) | READ-ONLY | No meet-up object — these are board posts with a category. No RSVP or capacity (replies stand in and are labelled as such). No time/place field, so nothing lands on the agenda or a map. No organizer-created meet-ups with hosts. | M |
| /engagement/community/social-groups | `engagement/community/social-groups/page.tsx` + `category-screen.tsx` (gap :91) | READ-ONLY | No group membership — a group here is a category, so nobody joins and nothing can message members. No private groups (every post is readable by every ticket holder). No group chat (DMs are two-party only). | M |
| /engagement/floormap | `engagement/floormap/page.tsx` (gap :140) | READ-ONLY | No upload and no pinning (same missing Storage path; fixing it once also unblocks venue map, sponsor banners and app branding). No booth coordinates on `ExhibitorDoc` (`RoomDoc` already has `mapX`/`mapY`). No links from a session or exhibitor to a pin (app work). No multiple floors. | M |
| /engagement/gamification | `engagement/gamification/page.tsx` (gap :119) | READ-ONLY | No points, rules or leaderboard — no collection, no dashboard screen, no app surface. Blocked on trigger deployment before it is blocked on UI. No prizes or redemption. | M |
| /engagement/live-polling | `engagement/live-polling/page.tsx` (gap :143) | READ-ONLY | Cannot create or edit a poll from the dashboard (polls exist in the model and in the app). Cannot open/close from here (`open` is a real field; a one-line write). No per-option breakdown. No projector results view. **The fix is deploying `tallyPoll`** — written and tested, needs Blaze. | S (after deploy) |
| /engagement/photos/photo-booth | `engagement/photos/photo-booth/page.tsx` (gap :137) | READ-ONLY | Nothing at all, and none of it is a dashboard screen — it lives in the app and in Storage. The frame an organizer would configure has nowhere to be stored. Also gated on a development build (camera), which Expo Go cannot give. | L |
| /engagement/photos/photo-collection | `engagement/photos/photo-collection/page.tsx` (gap :156) | READ-ONLY | No photo wall and no upload (the wall is downstream of the upload, which is downstream of Storage being wired at all). No moderation queue. No re-hosting of the hotlinked images that do exist — the cheapest worthwhile item on the page. | M |
| /engagement/photos/profile-photo-frames | `engagement/photos/profile-photo-frames/page.tsx` (gap :167) | READ-ONLY | No frame and nothing to frame. No avatar editor in the app (the change that would make this screen worth revisiting; app work). No share card — a server-rendered image at a public URL, which would also fix the missing per-page Open Graph cards. | M |
| /engagement/round-table | `engagement/round-table/page.tsx` + `gathering-screen.tsx` (gap :301) | CRUD− | Organizer-side placement works. Missing: any attendee surface; placements are names not accounts; no rotation between rounds (the same computation Speed Networking already does — pointing both at one model is the obvious next piece); no printable table cards. | S |
| /engagement/session-feedback | `engagement/session-feedback/page.tsx` + `engagement/survey-screen.tsx` (gap :232) | CRUD− | Survey authoring and status work. Missing: the attendee side — nothing in the app renders a survey, so nothing can answer one. No post-session prompt (push exists in the dashboard; Expo Go cannot receive it). Required questions are parsed and always written `false`. | M |
| /engagement/speed-networking | `engagement/speed-networking/page.tsx` (gap :248) | READ-ONLY (GET form; schedule regenerated per request, `readOnly` display field at `:164`) | **Nothing is saved** — the schedule lives in the URL. No app surface, so attendees cannot see who they meet next. No interest-based pairing. No timer. | M |
| /engagement/surveys | `engagement/surveys/page.tsx` + `survey-screen.tsx` (gap :232) | CRUD− | Same as session feedback: authoring works, no attendee-facing renderer, no prompt, required questions always `false`. | M |

### Marketing

| Route | File | Classification | What is missing | Effort |
|---|---|---|---|---|
| /marketing/event-webpages/agenda-webpage/analytics | `marketing/event-webpages/agenda-webpage/analytics/page.tsx` (gap :109) | READ-ONLY | Page views, unique visitors, referrers and time-on-page are not collected, stored or estimated anywhere. No chart. No agenda→ticket conversion join (that join is what a tracker is for). Adding a tracker is an untaken privacy decision. | M |
| /marketing/event-webpages/agenda-webpage/general-purpose | `marketing/event-webpages/agenda-webpage/general-purpose/page.tsx` + `marketing/webpage-screen.tsx` (gap :121) | READ-ONLY | No filtered special-purpose variant (would be a query parameter `/agenda` does not yet read). No page traffic analytics. No public per-session registration caps. No embed snippet. | S |
| /marketing/event-webpages/agenda-webpage/special-purpose | `marketing/event-webpages/agenda-webpage/special-purpose/page.tsx` (gap :109) | READ-ONLY | `/agenda` filters in the browser and does not read `?day=`/`?track=`, so every link on this screen goes to the unfiltered page (an afternoon in `apps/web`). No saved, named slice. No embed snippet. No per-slice traffic figures. | S |
| /marketing/event-webpages/artifact-webpage | `marketing/event-webpages/artifact-webpage/page.tsx` (gap :110) | READ-ONLY | The public page does not exist — and it must filter on `visibleToTicketTypes` server-side, since a page that renders all rows and hides them in CSS has published the gated ones. No file hosting. No download counts (links point off-site). No speaker upload. | S–M |
| /marketing/event-webpages/exhibitor-webpage | `marketing/event-webpages/exhibitor-webpage/page.tsx` (gap :172) | READ-ONLY | The public exhibitor page does not exist — "the smallest piece of real parity left on the Marketing tab". No exhibitor segment in the app's People tab. No per-exhibitor detail pages (`ExhibitorDoc` carries no offers/downloads). No exhibitor self-service. No embed snippet. | S |
| /marketing/event-webpages/logistics-webpage | `marketing/event-webpages/logistics-webpage/page.tsx` (gap :120) | READ-ONLY | No logistics editor — `SETTINGS_KEYS.logistics` exists in `lib/settings.ts` and **nothing reads or writes it**; the site would ignore whatever was saved. No logistics page in the app (no "Event info" screen, so no wifi password anywhere). No hotel blocks/travel booking. Static pages need a CMS to be editable. | M |
| /marketing/event-webpages/speaker-webpage | `marketing/event-webpages/speaker-webpage/page.tsx` + `webpage-screen.tsx` (gap :121) | READ-ONLY | No hand-ordering of speakers. No per-speaker public profile page. No speaker self-service editing (needs an auth path speakers do not have). No embed snippet. | S |
| /marketing/event-webpages/sponsor-webpage/sponsor-banner | `marketing/event-webpages/sponsor-webpage/sponsor-banner/page.tsx` (gap :134) | READ-ONLY | No banner slots in the app — that is the actual feature and everything else depends on it. No rotation or scheduling (no placement record). No impressions/taps. No artwork upload. | M |
| /marketing/event-webpages/sponsor-webpage/sponsor-list | `marketing/event-webpages/sponsor-webpage/sponsor-list/page.tsx` + `webpage-screen.tsx` (gap :121) | READ-ONLY | No tier reordering (`SponsorTier` is a union in `models.ts` — a code change and a deploy). No banner placement slots in the app. No per-sponsor public page with offers and downloads (the data exists on `SponsorDoc`; nothing renders it). No embed snippet. | S–M |
| /marketing/event-webpages/venue-map-webpage | `marketing/event-webpages/venue-map-webpage/page.tsx` (gap :108) | READ-ONLY | No floorplan upload (same Storage blocker as app branding and sponsor banners). No pin placement (a client component with pointer maths — cannot be built before there is an image). No multiple floors. No wayfinding (Whova has none either). | M |
| /marketing/event-website | `marketing/event-website/page.tsx` (gap :124) | READ-ONLY | The sixteen static pages are React files — changing the code of conduct is a pull request. Making them editable is a CMS (Phase 5; the largest single piece of website parity). No branding controls. No custom domain per event. No traffic analytics. | L |
| /marketing/organizer-co-promo | `marketing/organizer-co-promo/page.tsx` (gap :74) | READ-ONLY | No marketplace, partner events or exchange — explicitly not planned. No promotional slots in the app (same missing ad surfaces as sponsor banners). No reach/impression reporting. | N/A (declined) |
| /marketing/social-media-center/content-library | `marketing/social-media-center/content-library/page.tsx` (gap :121) | READ-ONLY | No image at all — no Storage upload, no resizing, no template rendering. Whova's library is mostly generated images, so this is most of the feature. No per-platform sizing. No branding applied to assets (App Branding must come first). No version history. | L |
| /marketing/social-media-center/social-media-manager | `marketing/social-media-center/social-media-manager/page.tsx` (gap :71) | INERT (no data read) | No connected accounts / OAuth to any platform. No scheduling or queue. No engagement reporting (needs the platform APIs). No hashtag monitoring (no social wall either). | L (declined on credential-handling grounds) |
| /marketing/social-wall/activity-stream-webpage | `marketing/social-wall/activity-stream-webpage/page.tsx` (gap :90) | READ-ONLY | No public announcements feed — the cheapest defensible half; a route in `apps/web` reading a top-level collection with no per-attendee content. Publishing the attendee board is a deliberate refusal. No embed snippet. No live refresh. | S |
| /marketing/social-wall/social-wall-customization | `marketing/social-wall/social-wall-customization/page.tsx` (gap :110) | READ-ONLY | No wall — needs a public route plus a rules change or a deliberate server-side bypass of the registered gate. No themes/colours/layouts. No pre-moderation (today's moderation is reactive; a projector needs approve-before-display). **No attendee opt-in consent to be projected** — the real blocker. | M |
| /marketing/whova-listing/my-event-listing | `marketing/whova-listing/my-event-listing/page.tsx` (gap :100) | READ-ONLY | No public event directory (not applicable, not planned). No editing of site metadata from here (title/description/OG card are code in `apps/web`, which reads no settings at request time). **No `Event` JSON-LD structured data — roughly an hour of work in `apps/web`, and nobody has done it.** | S |
| /marketing/whova-listing/traffic-analytics | `marketing/whova-listing/traffic-analytics/page.tsx` (gap :83) | INERT (no data read) | No listing views/saves/clicks (no listing). No traffic measurement on `knowledgegraph.tech` (a privacy position, not an oversight). No source→ticket attribution. | M |

### Pay

| Route | File | Classification | What is missing | Effort |
|---|---|---|---|---|
| /pay/balance | `pay/balance/page.tsx` (gap :126) | READ-ONLY | No payout schedule or history (Stripe owns them; mirroring goes stale). No payout request (a banking action that belongs behind Stripe's own auth, not a shared passphrase). No real fee reconciliation (needs Stripe's balance-transaction API). | M (declined in part) |
| /pay/billing-information | `pay/billing-information/page.tsx` | READ-ONLY (deliberately non-editable) | Nothing is editable. Card and bank details live in Stripe behind Stripe's authentication; a shared-passphrase session must not be sufficient to redirect the conference's income. | N/A (declined) |
| /pay/order-details | `pay/order-details/page.tsx` | INERT (18 lines, no data read) | No content — there is no platform bill to show. Whova's second orders tab exists because Whova charges the organizer. | N/A |
| /pay/publish | `pay/publish/page.tsx` (gap :141) | READ-ONLY | No tax rates or exemption rules (Stripe computes tax and is the only system that knows what was charged). No tax-exempt certificate handling. No filing or remittance. The tax figure shown is what orders recorded, not what Stripe will report at filing. | M (declined in part) |
| /publish | `publish/page.tsx` | READ-ONLY (pre-flight checklist) | Reads readiness and reports it. No action can be taken from the screen — no publish button, no fix-it links that write. | S |

### Tickets

| Route | File | Classification | What is missing | Effort |
|---|---|---|---|---|
| /tickets/attendee-customization/attendee-categories | `tickets/attendee-customization/attendee-categories/page.tsx` (gap :75) | INERT (no data read) | No category list here by design (one list, at Attendees › Categories). No ticket→category mapping — nothing turns a purchase into a label, and `Role` is a closed six-value union. No category-driven badge or access rules. | M |
| /tickets/attendee-customization/ticket-tiering | `tickets/attendee-customization/ticket-tiering/page.tsx` (gap :105) | READ-ONLY | No scheduled or volume-triggered pricing (one price per type). No editing from this screen (by design — Create Tickets owns it). Entitlements are two booleans, not a list; anything beyond workshops and the video library needs the add-on model, which does not exist. | M |
| /tickets/exhibitor-ticket-setup/2-1-exhibitor-tickets | `tickets/exhibitor-ticket-setup/2-1-exhibitor-tickets/page.tsx` + `tickets/audience-catalogue.tsx` (gap :208) | READ-ONLY (Edit links out to 1.1) | No dedicated exhibitor editor — Edit opens the attendee-shaped form, which has no field for booth size, staff pass count or banner placement. No booth inventory (an exhibitor tier in Whova is priced per booth size and buying one takes a booth out of stock). **A purchase creates no exhibitor record** — `orders` and `exhibitors` have no link at all. | M |
| /tickets/exhibitor-ticket-setup/2-2-question-forms | `tickets/exhibitor-ticket-setup/2-2-question-forms/page.tsx` + `tickets/question-form-screen.tsx` (gap :314) | **CRUD** (create/edit/delete/reorder/toggle) | No conditional logic. **No file-upload question** (Storage blocker 3). Answers not editable after purchase. Answers not in the CSV exports (fixed columns; needs a dynamic header). Nothing prunes `pendingAnswers` — `expiresAt` exists and no scheduled job reads it (needs Cloud Functions). | S–M |
| /tickets/exhibitor-ticket-setup/2-3-booth-selection | `tickets/exhibitor-ticket-setup/2-3-booth-selection/page.tsx` (gap :243) | CRUD− (transactional booth allocation — the only non-counter allocation in the product) | No drawn floor plan (Storage blocker + per-booth coordinates the model has room for and nothing writes). Exhibitors cannot pick their own space (inventory cannot be held across the Stripe redirect). Nothing links a purchase to a booth automatically — the order id is typed in. | M |
| /tickets/exhibitor-ticket-setup/2-4-confirmation-emails | `tickets/exhibitor-ticket-setup/2-4-confirmation-emails/page.tsx` + `tickets/audience-registration.tsx` (gap :523) | READ-ONLY | No copy editor (templates are TypeScript in `scripts/src/lib/email.ts`, deliberately code because the message carries the claim code). No exhibitor-specific content (booth number, load-in time — none exists as data). No resend from this screen. | S |
| /tickets/exhibitor-ticket-setup/2-5-ticket-add-ons | `tickets/exhibitor-ticket-setup/2-5-ticket-add-ons/page.tsx` (gap :238) | READ-ONLY | An extra cannot be bought with a package — Checkout builds one line item with `quantity: 1`, so a booth plus two passes is three purchases. Nothing links a pass purchase to an exhibitor (`passesAllocated` is raised by hand). Capacity is a counter, not a reservation. No post-purchase upsell. | M |
| /tickets/exhibitor-ticket-setup/2-6-offline-payment | `tickets/exhibitor-ticket-setup/2-6-offline-payment/page.tsx` (gap :136) | CRUD− (records a manual order — works) | No tax line. No refund from here (no payment intent to refund against; cancelling is a Firebase console job on purpose). No bank reconciliation. No approval step — any allowlisted organizer can record any amount; the audit entry is the only control. | S |
| /tickets/exhibitor-ticket-setup/2-7-registration-page | `tickets/exhibitor-ticket-setup/2-7-registration-page/page.tsx` + `audience-registration.tsx` (gap :163) | READ-ONLY | No copy editor or theming (headings and layout are code). No preview inside the dashboard (the site is a separate deployment). No terms-acceptance record — storing who accepted which version of the terms is a legal record. | M |
| /tickets/exhibitor-ticket-setup/2-8-registration-widget | `tickets/exhibitor-ticket-setup/2-8-registration-widget/page.tsx` + `audience-registration.tsx` (gap :255) | READ-ONLY | No embed snippet, iframe route or script tag — nothing in `apps/web` renders inside another origin. No public catalogue API (every `ticketTypes` read is Admin-SDK server-side; the collection has no rules match block on purpose). | M |
| /tickets/exhibitor-ticket-setup/discount-codes | `tickets/exhibitor-ticket-setup/discount-codes/page.tsx` (gap :76) | INERT (no data read) | No code list of its own (deliberate — a second table of the same Stripe codes would imply a scope that does not exist). No exhibitor-only redemption (nothing checks who redeems). No exhibitor checkout to redeem at. | M |
| /tickets/exhibitor-ticket-setup/pre-paid-exhibitors | `tickets/exhibitor-ticket-setup/pre-paid-exhibitors/page.tsx` (gap :218) | CRUD− (records a manual order) | An order does not create the exhibitor record (the two collections have no link). Staff passes are not issued from here — one manual order per person, which does not scale past a handful. No exhibitor self-service portal (needs the capability-token pattern, which exists, plus Storage uploads, which do not). | M |
| /tickets/exhibitor-ticket-setup/registration-settings | `tickets/exhibitor-ticket-setup/registration-settings/page.tsx` + `audience-registration.tsx` (gap :381) | READ-ONLY | No form on this screen by design (the fields belong to the package). No waitlist, transfers or buyer-initiated refunds — each a policy decision first. | M |
| /tickets/export-to-ams-crm | `tickets/export-to-ams-crm/page.tsx` | INERT (documentation, no data read) | No outbound webhook — the page argues this is the one worth building first, since Zapier fans a single webhook out. *(page states 1–2 days)* | S |
| /tickets/hubspot-connection-guide | `tickets/hubspot-connection-guide/page.tsx` | INERT (documentation, no data read) | No HubSpot integration. Manual CSV round-trip only. | M |
| /tickets/memberclicks-connection-guide | `tickets/memberclicks-connection-guide/page.tsx` | INERT (documentation, no data read) | No MemberClicks integration; no AMS credential exists in the repo. | M |
| /tickets/orders-and-transactions/attendee-orders | `tickets/orders-and-transactions/attendee-orders/page.tsx` | CRUD− (refund + mark-invoice-paid; re-asks for the passphrase) | No order creation or cancellation from here; no line-level edit. Refunds are whole-payment-intent operations. | S |
| /tickets/orders-and-transactions/exhibitor-orders | `tickets/orders-and-transactions/exhibitor-orders/page.tsx` + `tickets/audience-orders.tsx` (gap :229) | READ-ONLY | No refunds or mark-paid here (deliberate — a refund against a mixed order touches the whole payment intent). Per-line amounts are apportioned by line count, not exact. None of the columns an exhibitor ledger wants (booth number, deliverables outstanding, contract status) is modelled anywhere. | M |
| /tickets/orders-and-transactions/sponsor-orders | `tickets/orders-and-transactions/sponsor-orders/page.tsx` + `audience-orders.tsx` (gap :229) | READ-ONLY | Same as exhibitor orders: no refunds/mark-paid, apportioned rather than exact per-line amounts, no sponsor-specific ledger columns. | M |
| /tickets/orders-and-transactions/summary | `tickets/orders-and-transactions/summary/page.tsx` | READ-ONLY | Reporting only. No sales-over-time chart, no drill-through, no export from this screen. | S |
| /tickets/orders-and-transactions/transaction-history | `tickets/orders-and-transactions/transaction-history/page.tsx` | READ-ONLY | Raw log only. No filtering by type, no export, no dispute annotation. | S |
| /tickets/payout | `tickets/payout/page.tsx` (gap :193) | READ-ONLY | No bank details, schedule or verification (deliberate — those live in Stripe behind Stripe's auth). No instant payout. No per-payout breakdown (Stripe's balance-transaction API; a page of round trips). | M (declined in part) |
| /tickets/publish-tickets | `tickets/publish-tickets/page.tsx` (gap :306) | READ-ONLY (readiness check) | No scheduled go-live button (already expressible via `salesOpenAt`, evaluated at read time). No preview of an unpublished page (no staging copy of the site). Nothing here checks the exhibitor or sponsor catalogues. | S |
| /tickets/sponsor-ticket-setup/confirmation-emails | `tickets/sponsor-ticket-setup/confirmation-emails/page.tsx` + `audience-registration.tsx` (gap :523) | READ-ONLY | No copy editor, no sponsor-specific content (deliverables checklist), no resend. | S |
| /tickets/sponsor-ticket-setup/discount-codes | `tickets/sponsor-ticket-setup/discount-codes/page.tsx` (gap :69) | INERT (no data read) | No code list of its own (deliberate). No sponsor-only redemption. **No negotiated discount recorded against a sponsor** — `sponsors` documents carry no commercial terms and no link to an order; this is the closer fit for the event and is unmodelled. | M |
| /tickets/sponsor-ticket-setup/question-forms | `tickets/sponsor-ticket-setup/question-forms/page.tsx` + `question-form-screen.tsx` (gap :314) | **CRUD** | Same five caveats as the other question-form screens: no conditional logic, no file-upload question, answers not editable post-purchase, answers absent from CSV exports, nothing prunes `pendingAnswers`. | S–M |
| /tickets/sponsor-ticket-setup/registration-page | `tickets/sponsor-ticket-setup/registration-page/page.tsx` + `audience-registration.tsx` (gap :163) | READ-ONLY | No copy editor or theming, no in-dashboard preview, no terms-acceptance record. | M |
| /tickets/sponsor-ticket-setup/registration-settings | `tickets/sponsor-ticket-setup/registration-settings/page.tsx` + `audience-registration.tsx` (gap :381) | READ-ONLY | No form by design; no waitlist, transfers or buyer-initiated refunds. | M |
| /tickets/sponsor-ticket-setup/registration-widget | `tickets/sponsor-ticket-setup/registration-widget/page.tsx` + `audience-registration.tsx` (gap :255) | READ-ONLY | No embed snippet or iframe route; no public catalogue API. | M |
| /tickets/sponsor-ticket-setup/sponsor-tickets | `tickets/sponsor-ticket-setup/sponsor-tickets/page.tsx` + `audience-catalogue.tsx` (gap :208) | READ-ONLY (Edit links out to 1.1) | No dedicated sponsor editor. **No benefit fulfilment** — `TicketTypeDoc.includes` holds display bullets nothing reads as entitlements, so buying a tier grants none of it. **No complimentary passes** — needs a tier that mints N registrations at fulfilment; today one order line produces one registration. No sponsor-scoped invoice flow, and Sponsor Manager records no amount owed. | M |
| /tickets/ticket-marketing/campaign-contact-list | `tickets/ticket-marketing/campaign-contact-list/page.tsx` (gap :242) | CRUD− (import + subscribe toggle) | Bounces are not detected automatically (needs a Resend webhook — a route in `apps/web`, ~a day). **No public unsubscribe link — a legal requirement in several jurisdictions before any bulk send** (needs a capability-token route; the mechanism already exists for `/order/{token}`). `converted` is never computed. No export. | S |
| /tickets/ticket-marketing/campaign-link-tracking | `tickets/ticket-marketing/campaign-link-tracking/page.tsx` (gap :112) | CRUD− (create + toggle) | No unique-visitor count. No UTM builder. No per-day chart (one counter per link, not a time series). Attribution is last-click/30-day by convention, stated so it can be argued with. | S |
| /tickets/ticket-marketing/email-campaign | `tickets/ticket-marketing/email-campaign/page.tsx` (gap :187) | CRUD− (sends, works) | **No public unsubscribe link — the most significant gap on the page and a legal requirement.** No open/click tracking. No templates, drafts or scheduling. No segmentation beyond the list (needs the `converted` flag computed). | S |
| /tickets/ticket-marketing/event-listing | `tickets/ticket-marketing/event-listing/page.tsx` (gap :165) | READ-ONLY | No marketplace (a decision, not a backlog item). **No `schema.org/Event` JSON-LD on the public pages** — the one genuinely missing piece, generated from data that already exists. No submission tracking (Projects & Checklists is the checklist). | S |
| /tickets/ticket-marketing/event-website | `tickets/ticket-marketing/event-website/page.tsx` (gap :173) | READ-ONLY | No content editor — every page is a React file, so changing the code of conduct is a deploy; that is Phase 5 and the real gap. No theming (Storage blocker). No hosted alternative site (declined — KGC's website *is* its ticketing). | L |
| /tickets/ticket-marketing/referral-contest | `tickets/ticket-marketing/referral-contest/page.tsx` (gap :171) | CRUD− (create + toggle links) | No prize, discount or payout (would mean creating a Stripe code per referrer and reading redemptions back — ~a day). Referrers cannot see their own numbers (needs a capability-token page). No self-service sign-up — each link is created by hand. | S |
| /tickets/ticket-marketing/social-sharing | `tickets/ticket-marketing/social-sharing/page.tsx` (gap :155) | CRUD− (create + toggle links) | No posting, scheduling or connected accounts (deliberate). No share buttons in the attendee app (no share sheet wired). No per-post Open Graph image (needs the image pipeline, blocker 3). | M |
| /tickets/ticket-setup/1-1-create-tickets | `tickets/ticket-setup/1-1-create-tickets/page.tsx` | CRUD− (create/edit + visibility toggle) | No delete. **No control for `includesWorkshops` / `includesVideoLibrary`** — `saveTicketTypeAction` carries the existing value forward and writes `false` for a new tier, so a tier created here can never include workshops. No add-ons, no scheduled/volume pricing. | S |
| /tickets/ticket-setup/1-2-question-forms | `tickets/ticket-setup/1-2-question-forms/page.tsx` + `question-form-screen.tsx` (gap :314) | **CRUD** | No conditional logic; no file-upload question; answers not editable post-purchase; answers absent from CSV exports; nothing prunes `pendingAnswers`. | S–M |
| /tickets/ticket-setup/1-3-confirmation-emails | `tickets/ticket-setup/1-3-confirmation-emails/page.tsx` (gap :133) | READ-ONLY | No template editor, preview or test send — **the preview is cheap and worth doing first** (the templates are pure functions returning HTML). No per-ticket-type confirmation copy. No attachments and no `.ics`. No resend button. | S |
| /tickets/ticket-setup/1-4-registration-pages | `tickets/ticket-setup/1-4-registration-pages/page.tsx` (gap :110) | READ-ONLY | No page builder or theming (Phase 5, a CMS project). No preview from the dashboard. No terms-acceptance record. | M |
| /tickets/ticket-setup/1-5-registration-widgets | `tickets/ticket-setup/1-5-registration-widgets/page.tsx` (gap :69) | INERT (no data read) | No embed snippet, iframe route or script tag. No public catalogue API. No per-partner attribution (that is campaign link tracking, itself only partly built). | M |
| /tickets/ticket-setup/1-6-abandoned-registration | `tickets/ticket-setup/1-6-abandoned-registration/page.tsx` (gap :132) | READ-ONLY | No recovery email — the sender works, the addresses do not exist (would mean capturing the email before the Stripe redirect, or reading expired sessions back on a schedule). No funnel (no website analytics). No cart to resume (a Checkout session cannot be reopened). | M |
| /tickets/ticket-setup/1-7-registration-settings | `tickets/ticket-setup/1-7-registration-settings/page.tsx` (gap :125) | READ-ONLY | No form by design (the fields belong to the ticket type). No waitlist, transfers or attendee-initiated refunds. No event-wide registration switch — a `settings` collection could hold one but nothing on the purchase path reads it. | M |
| /tickets/ticket-setup/create-group-tickets | `tickets/ticket-setup/create-group-tickets/page.tsx` (gap :121) | READ-ONLY | No bundle product ("Team of 5" as a type with a seat count). No group organizer portal (the seat list is fixed when the invoice is raised). No multi-seat card checkout (`quantity: 1` hard-coded). **No "invoice this company" action from the dashboard — a real, small gap, since `raiseInvoice()` already exists.** | S–M |
| /tickets/ticket-setup/discount-codes | `tickets/ticket-setup/discount-codes/page.tsx` | CRUD− (create + toggle, against Stripe) | No delete, no edit, no per-audience scope, no redemption-by-whom check. | S |
| /tickets/ticket-setup/imis-connection-guide | `tickets/ticket-setup/imis-connection-guide/page.tsx` | INERT (documentation, no data read) | No iMIS integration; no AMS credential in the repo. | M |
| /tickets/ticket-setup/member-and-invite-only-ticketing | `tickets/ticket-setup/member-and-invite-only-ticketing/page.tsx` (gap :101) | READ-ONLY | No invite list and no per-person single-use code (Stripe holds one shared code per promotion). No membership integration. **No allowlisted email domains** — the cheapest real restriction (a field on the ticket type plus a check in `startCheckout`), worth doing before any AMS work. | S |
| /tickets/ticket-setup/memberclicks-connection-guide | `tickets/ticket-setup/memberclicks-connection-guide/page.tsx` | INERT (documentation, no data read) | No MemberClicks integration. | M |
| /tickets/ticket-setup/neon-crm-connection-guide | `tickets/ticket-setup/neon-crm-connection-guide/page.tsx` | INERT (documentation, no data read) | No Neon CRM integration. | M |
| /tickets/ticket-setup/session-rsvp | `tickets/ticket-setup/session-rsvp/page.tsx` (gap :109) | INERT (no data read) | No RSVP, waitlist or cancellation — nothing writes a per-session booking, so there is no list and no capacity to enforce. No session-level check-in. Bookmark counts deliberately not shown (a number labelled "interested" becomes a catering order). | M |
| /tickets/ticket-setup/ticket-add-ons | `tickets/ticket-setup/ticket-add-ons/page.tsx` (gap :90) | READ-ONLY | No add-on products — nothing in the model is purchasable except a ticket type, and nothing on an order distinguishes an extra from a seat. No per-add-on capacity or reporting. No post-purchase upsell (no flow anywhere charges an existing ticket holder). | M |
| /tickets/ticket-setup/yourmembership-connection-guide | `tickets/ticket-setup/yourmembership-connection-guide/page.tsx` | INERT (documentation, no data read) | No YourMembership integration. | M |

### Tools

| Route | File | Classification | What is missing | Effort |
|---|---|---|---|---|
| /tools/admin-control/code-access-control | `tools/admin-control/code-access-control/page.tsx` | CRUD− (writes the settings doc) | **The invitation code is stored and not enforced** — nothing on the sign-in path reads it (stated on the Admin Settings gap note, `attendees/admin-settings/page.tsx:113`). | S |
| /tools/admin-control/post-event-access-duration | `tools/admin-control/post-event-access-duration/page.tsx` | CRUD− (writes the settings doc) | Nothing enforces the duration — no client reads it and no job revokes access when it lapses. | S |
| /tools/app-adoption/app-adoption-email | `tools/app-adoption/app-adoption-email/page.tsx` (gap :109) | READ-ONLY | Cannot send it, and cannot send only to the people who need it (the segment exists on Attendees › Segments and as a CSV). No open/click tracking (adoption is measured from who has a profile, which is the better number). | S |
| /tools/app-adoption/app-download-button | `tools/app-adoption/app-download-button/page.tsx` (gap :89) | INERT (no data read) | **No QR code** — the app already ships a dependency-free QR encoder (`app/src/lib/qr/encode.ts`) and this dashboard does not use it; worth wiring. No store badges or deep links (the app is not listed). No copy-to-clipboard button. | S |
| /tools/app-adoption/downloadable-graphics | `tools/app-adoption/downloadable-graphics/page.tsx` | INERT (documentation, no data read) | No asset pipeline, no generated images, nothing to download. | M |
| /tools/app-adoption/social-media | `tools/app-adoption/social-media/page.tsx` (gap :72) | READ-ONLY | No posting from the dashboard (declined — OAuth tokens behind a shared passphrase with no per-person identity). No scheduling. No generated images (no asset pipeline). | L (declined) |
| /tools/app-adoption/web-app-link | `tools/app-adoption/web-app-link/page.tsx` | INERT (no data read) | **There is no web app** — the attendee app is React Native under Expo with no web build; the screen exists to say so. | L |
| /tools/moderator-tools/community-board | `tools/moderator-tools/community-board/page.tsx` (gap :247) | CRUD− (hide/restore posts and replies) | No photo or session-chat queues (neither feature exists in the app). **No attendee reporting** — the thing that actually fills a moderation queue; needs a `reports` collection and a rule letting any signed-in attendee write one. No author banning (needs a claim the rules can read). | S–M |
| /tools/moderator-tools/moderate-session-qanda | `tools/moderator-tools/moderate-session-qanda/page.tsx` (gap :81) | READ-ONLY | No moderation actions here by design (they live on Session Q&A Manager). No moderator shift assignment or hand-off notes (no staff model). **Upvote counts do not move** — the counter trigger is written and undeployed, so the queue is ordered by time rather than popularity. | S (after deploy) |
| /tools/moderator-tools/photos | `tools/moderator-tools/photos/page.tsx` (gap :76) | INERT (no data read) | No photo queue, hide action or reports — nothing writes an image document, so there is no collection to read. Profile avatars are unmoderated (`photoURL` comes from the sign-in provider). | M |
| /tools/moderator-tools/session-chats | `tools/moderator-tools/session-chats/page.tsx` (gap :89) | INERT (no data read) | No chat collection and no queue — nothing under `sessions/{id}` holds free-form messages. Live moderation needs a different shape than a server-rendered page anyway. No word filter or auto-moderation anywhere (deliberate). | L |
| /tools/report | `tools/report/page.tsx` | READ-ONLY | The deliberate replacement for Whova's 10-day PDF. Reports only; no export, no scheduling, no delivery. | S |

### Virtual & Hybrid

| Route | File | Classification | What is missing | Effort |
|---|---|---|---|---|
| /virtual-and-hybrid/adv-stream-integration/microsoft-teams | `virtual-and-hybrid/adv-stream-integration/microsoft-teams/page.tsx` (gap :59) | INERT (no data read) | No Microsoft identity of any kind — no Entra app registration, no Graph client, no tenant. No meeting link field on a session. No attendance import. | L |
| /virtual-and-hybrid/adv-stream-integration/zoom | `virtual-and-hybrid/adv-stream-integration/zoom/page.tsx` (gap :72) | INERT (no data read) | No Zoom credentials anywhere — no OAuth flow, no token store, no `ZOOM_*` env var in any of the three apps. No meeting link field on `SessionDoc`. No second webhook endpoint (only Stripe's exists). | L |
| /virtual-and-hybrid/attendance-gamification | `virtual-and-hybrid/attendance-gamification/page.tsx` (gap :69) | INERT (no data read) | No points, leaderboard or prizes; nothing in `models.ts` scores an attendee. The counters it needs are undeployed triggers (Spark). Attendance *is* measured on Analytics & Exports, just not scored. | M |
| /virtual-and-hybrid/attendee-activity | `virtual-and-hybrid/attendee-activity/page.tsx` (gap :77) | INERT (no data read; static signal table) | No per-attendee timeline — the signals live in six collections with no join key, so stitching them is a query fan-out per row. No last-seen, time-in-app or screen views (no analytics SDK in the app). No session dwell time (needs a stream or a scan on the way out; Checkout is unbuilt). | M |
| /virtual-and-hybrid/logistics-management/emergency-manager | `virtual-and-hybrid/logistics-management/emergency-manager/page.tsx` (gap :95) | CRUD− (saves the plan to `settings`) | No alert broadcast (the sender is real, the audience empty; push needs a development build). **The plan is not visible to attendees** — it lives in `settings`, which no client may read. No incident log (a safeguarding record that should not be improvised into a settings bag). No staff roster or radio channels — team members are not modelled at all. | M |
| /virtual-and-hybrid/logistics-management/event-checklist | `virtual-and-hybrid/logistics-management/event-checklist/page.tsx` (gap :95) | READ-ONLY (deliberate mirror of Projects & Checklists) | No editing here by design. No starter checklist. No reminders — overdue is computed and shown, and nothing emails the assignee; that is a scheduled job, which needs Blaze. | S |
| /virtual-and-hybrid/online-session-manager/rehearsal-sessions | `virtual-and-hybrid/online-session-manager/rehearsal-sessions/page.tsx` (gap :70) | INERT (no data read) | No rehearsal booking, because there is no room to book. No rehearsed/not-rehearsed status on `SpeakerDoc`. No calendar invitations — there is no `.ics` generation anywhere in the repo. | M |
| /virtual-and-hybrid/online-session-manager/streaming-setup | `virtual-and-hybrid/online-session-manager/streaming-setup/page.tsx` (gap :78) | INERT (no data read) | Nothing streams and no session can be configured to — `SessionDoc` carries no stream URL, key or provider field, so there is not even a place to record an intention. No "live now" state. **A live ticket tier was sold against this.** | L |
| /virtual-and-hybrid/other-tools | `virtual-and-hybrid/other-tools/page.tsx` (gap :95) | INERT (no data read) | None of the six tools exist: no pronunciation field on `SpeakerDoc` (and audio needs the upload pipeline), no countdown component, no asset library, no captioning (a budget line, not a screen). | M |
| /virtual-and-hybrid/tutorials-and-tips | `virtual-and-hybrid/tutorials-and-tips/page.tsx` (gap :72) | INERT (no data read) | No in-app help centre and none planned. No tutorial videos (needs the absent video-hosting capability). No contextual tips (the gap notes are the substitute, without a content system). | M (declined) |
| /virtual-and-hybrid/virtual-and-hybrid-setup | `virtual-and-hybrid/virtual-and-hybrid-setup/page.tsx` (gap :155) | READ-ONLY | No format switch (one mode, in person). No per-session stream configuration (`SessionDoc` has no stream field). No virtual-attendee experience — the app is built for someone in the building; a remote attendee gets an agenda, a community board and nothing to watch. | L |

### Framework routes

| Route | File | Classification | What is missing | Effort |
|---|---|---|---|---|
| /[...slug] | `[...slug]/page.tsx` | INERT (fallback) | Serves any nav path whose screen does not exist, rendering a `GAPS` entry from `lib/gaps.ts`. **Currently unreachable** — every leaf in `nav.ts` has a real file, so the whole `GAPS` record is dead code kept for the next path added ahead of its screen. | — |

---

## Clusters

The 143 gap-noted routes reduce to eleven shared root causes. Fixing a cluster head unblocks
everything under it; the counts below are routes whose gap note names that blocker.

### 1. No file upload — nothing in this project writes to Storage (~24 routes)

`storage.rules` exists and has no writer. This is `ROADMAP.md` blocker 3, and it is the single
highest-leverage item in this audit — it is named on more screens than any other cause.

Blocked: `/content/branding-center/app-branding`, `/content/branding-center/web-app-speaker-page`,
`/content/documents-and-videos/documents`, `/content/exhibitor-center/exhibitor-manager` (logo),
`/content/logistics-center`, `/content/sponsor-center/advanced-banners`,
`/content/sponsor-center/sponsor-manager`, `/content/artifact-center-*/artifact-manager`,
`/engagement/floormap`, `/engagement/photos/photo-collection`, `/engagement/photos/photo-booth`,
`/engagement/photos/profile-photo-frames`, `/engagement/announcement-wall/activity-stream-webpage`,
`/marketing/event-webpages/venue-map-webpage`,
`/marketing/event-webpages/sponsor-webpage/sponsor-banner`, `/marketing/event-website`,
`/marketing/social-media-center/content-library`, `/tickets/ticket-marketing/event-website`,
`/tickets/ticket-marketing/social-sharing` (OG images), all three question-form screens (file-upload
question), `/tickets/exhibitor-ticket-setup/pre-paid-exhibitors` and
`/tickets/exhibitor-ticket-setup/2-3-booth-selection` (floor plan), `/tools/app-adoption/downloadable-graphics`,
`/virtual-and-hybrid/other-tools` (pronunciation audio), `/attendees/name-badges` (designer assets).

**Head:** one upload component (picker + size limit + MIME check + progress), a Storage write path
through the Admin SDK, and an image-resize step. Everything else on this list becomes a form field.

### 2. Cloud Functions written but not deployed — needs Blaze (~9 routes)

Eight aggregate triggers exist in `functions/src/triggers/` with 14 passing tests against the
emulator. Deployment is the only missing step, and Blaze's free quotas equal Spark's.

Blocked: `/engagement/live-polling` (`tallyPoll`), `/content/agenda-center/session-qanda-manager` and
`/tools/moderator-tools/moderate-session-qanda` (upvote counters),
`/engagement/gamification`, `/virtual-and-hybrid/attendance-gamification`,
`/attendees/manage-attendees/analytics-and-exports` (engagement scores),
`/content/sponsor-center/advanced-banners` (impression counting),
`/virtual-and-hybrid/logistics-management/event-checklist` (scheduled reminders), and all three
question-form screens (`pendingAnswers` pruning needs a scheduled job).

**Head:** a card on file. This is the cheapest cluster on the page.

### 3. No submission-form / response-store capability (~8 routes)

Question Forms exist for *purchase-time* answers only. There is no general public form with an
answers store and no versioned consent record.

Blocked: `/attendees/segments` (the whole feature), `/attendees/categories`,
`/attendees/release-and-consent-forms`, `/attendees/call-for-volunteers/*` (both),
`/content/speaker-center/release-and-consent-forms`, `/content/call-for-speakers-abstracts`,
`/engagement/community/attendee-matchmaking`.

**Head:** a generic form + response store, then an append-only consent record versioned against the
agreed wording. `NotBuilt` cards estimate 6–9 days for the forms, 3–5 days per consumer after that.

### 4. No per-session attendance model (~7 routes)

`checkInLists` is modelled per *event*. The engine already supports another scope — each scope is
another document — so the missing piece is the UI that creates one per session and selects it by
clock, plus the reporting on top.

Blocked: `/attendees/check-in-and-checkout/session-self-check-in`,
`/attendees/check-in-and-checkout/check-in` (scope UI), `/attendees/certificates` (hours to print),
`/attendees/session-cap`, `/tickets/ticket-setup/session-rsvp`,
`/attendees/manage-attendees/analytics-and-exports` (session-level reporting),
`/virtual-and-hybrid/attendee-activity` (dwell time).

**Head:** 1–2 days for session scope; certificates and caps then become their own smaller pieces.

### 5. No public-page routes in `apps/web` (~9 routes)

Several screens are complete on the dashboard side and are waiting on a route in the public site.
These are the cheapest wins in the audit.

Blocked: `/marketing/event-webpages/exhibitor-webpage` ("the smallest piece of real parity left"),
`/marketing/social-wall/activity-stream-webpage` and
`/engagement/announcement-wall/activity-stream-webpage` (an `announcements` feed),
`/marketing/event-webpages/artifact-webpage`,
`/marketing/event-webpages/agenda-webpage/special-purpose` (`?day=` / `?track=` — "an afternoon"),
`/content/branding-center/branded-event-url` (`/[slug]`),
`/marketing/whova-listing/my-event-listing` and `/tickets/ticket-marketing/event-listing`
(`schema.org/Event` JSON-LD — "roughly an hour"),
`/marketing/event-webpages/sponsor-webpage/sponsor-list` (per-sponsor page).

### 6. No streaming / video infrastructure — argued as a candidate to cut (~8 routes)

`SessionDoc` has no stream URL, key or provider field, so there is nowhere to record even an
intention. `TicketTypeDoc.includesVideoLibrary` is sold on two tiers and served by nothing.

Blocked: `/virtual-and-hybrid/virtual-and-hybrid-setup`, `/virtual-and-hybrid/online-session-manager/streaming-setup`,
`/virtual-and-hybrid/online-session-manager/rehearsal-sessions`,
`/virtual-and-hybrid/adv-stream-integration/zoom`, `/virtual-and-hybrid/adv-stream-integration/microsoft-teams`,
`/content/documents-and-videos/video-hosting`, `/content/documents-and-videos/attendee-video-access`,
`/content/artifact-center-poster-pitch-gallery/artifact-streaming`.

**Note:** a live ticket tier was sold against the video library. Even if streaming is cut, that
promise needs an answer.

### 7. Closed unions in `packages/shared/src/models.ts` (~7 routes)

Four "cannot create" gaps are the same fact: the type is a union, so adding a value is a
shared-package change, a rules review and a deploy rather than a form.

`Role` (six values) blocks `/attendees/categories` and `/tickets/attendee-customization/attendee-categories`.
`SponsorTier` (four values) blocks `/content/sponsor-center/sponsor-tiering`,
`/content/sponsor-center/sponsor-manager` and `/marketing/event-webpages/sponsor-webpage/sponsor-list`.
Track identity is cached on `SessionDoc` (`primaryTrackName`, `primaryTrackColor`), which blocks
`/content/agenda-center/track-manager` behind a rename fan-out.

### 8. No second identity surface — speakers, sponsors, exhibitors have no login (~9 routes)

Whova's real design is a personal link per counterparty. This project has that pattern **exactly
once**, for order confirmation pages (`/order/{token}`), and has not generalised it. The email
sender it also needs now exists.

Blocked: `/content/speaker-center/speaker-manager` (self-service bio form),
`/content/sponsor-center/sponsor-manager` (sponsor portal),
`/tickets/exhibitor-ticket-setup/pre-paid-exhibitors` and `/marketing/event-webpages/exhibitor-webpage`
(exhibitor portal), `/content/exhibitor-center/exhibitor-trivia` (question authoring),
`/content/fair-center/fair-manager` (employer accounts),
`/content/artifact-center-*/artifact-manager` (presenter upload),
`/marketing/event-webpages/artifact-webpage` (speaker upload),
`/tickets/ticket-marketing/referral-contest` (referrer self-service).

**Head:** generalise the capability-token route. The HMAC and the pattern already exist.

### 9. Missing commerce model pieces (~10 routes)

Four distinct absences in the money path, each named on several screens: **no add-on product**
(nothing is purchasable except a ticket type, and Checkout hard-codes `quantity: 1`); **no
order→entity link** (buying an exhibitor or sponsor package creates no `exhibitors`/`sponsors`
record; `TicketTypeDoc.includes` is display bullets nothing reads as entitlements); **no repeat
charge** (no flow anywhere charges someone who already holds a ticket); **no public unsubscribe
link** on the two bulk-mail screens, which is a legal requirement.

Blocked: `/tickets/ticket-setup/ticket-add-ons`, `/tickets/exhibitor-ticket-setup/2-5-ticket-add-ons`,
`/tickets/ticket-setup/create-group-tickets`, `/tickets/attendee-customization/ticket-tiering`,
`/attendees/ticket-session-mapping`, `/tickets/sponsor-ticket-setup/sponsor-tickets`,
`/tickets/exhibitor-ticket-setup/2-1-exhibitor-tickets`,
`/tickets/orders-and-transactions/{exhibitor,sponsor}-orders`,
`/tickets/ticket-marketing/{email-campaign,campaign-contact-list}`.

### 10. Settings written and never read (5 routes)

Five screens save a document nothing consumes, which is the most misleading failure mode in the
dashboard — the save succeeds and nothing changes.

- `/content/branding-center/app-branding` — no surface reads the branding doc.
- `/content/branding-center/branded-event-url` — `apps/web` has no `/[slug]`.
- `/tools/admin-control/code-access-control` — the invitation code is stored and unenforced.
- `/tools/admin-control/post-event-access-duration` — nothing enforces the duration.
- `/virtual-and-hybrid/logistics-management/emergency-manager` — the plan lives in `settings`,
  which no client may read.

Plus `SETTINGS_KEYS.logistics` (`lib/settings.ts`), which is a reserved name nothing reads *or*
writes, noted on `/marketing/event-webpages/logistics-webpage`.

### 11. Non-gap-note defects found by grep

- **36 hard-`disabled` buttons and menu items** across eight screens, each with
  `title="Not built — see below"` or similar. Unlike the gap notes, **these are not behind
  `SHOW_GAP_NOTES`** — they render in a demo as greyed-out chrome, which is the exact
  "implies this half-works" failure `ui.tsx:342` argues against. Worst concentrations:
  `content/agenda-center/session-manager/page.tsx` (6), `content/speaker-center/speaker-manager/page.tsx` (10),
  `content/sponsor-center/sponsor-manager/page.tsx` (7), `engagement/announcements/page.tsx` (5),
  `attendees/manage-attendees/attendees/page.tsx` (3), `attendees/check-in-and-checkout/check-in/page.tsx` (3),
  `content/basics/page.tsx` (1), `(dash)/layout.tsx` (1).
  Two of them — check-in's CSV exports at `check-in/page.tsx:96–97` — are disabled although the
  export registry already serves six working CSVs, so that pair is a wiring gap rather than a
  feature gap.
- **`(dash)/layout.tsx:149,154` hard-codes `http://localhost:8081` and
  `http://localhost:3000/tickets`.** Every other cross-app link resolves `WEB_PUBLIC_ORIGIN`
  (defaulting to `:3200`). Both Preview links are dead on the deployed Netlify site, and the `:3000`
  port does not match the documented `:3200` even locally.
- **40 of the 175 route files read no Firestore data at all** — their only `await` is
  `requireOrganizer()`. Excluding the `[...slug]` catch-all, that is **39 of the 173 nav screens**.
  This contradicts "all 173 screens read or write real Firestore data" in
  `apps/organizer/README.md` and `ROADMAP.md`. They are honest prose screens, not stubs, but the
  claim should be restated as "all 173 render without a server-side throw; 134 read or write real
  data".
- **"What Whova does / What this would need" prose is rendered in a plain `Panel`, not a
  `GapPanel`, on 24 page files plus two shared components** (`(dash)/integration-guide.tsx` and
  `(dash)/tickets/audience-registration.tsx`). Through `integration-guide.tsx` alone that reaches
  ten more routes whose entire content is "we do not integrate with this vendor; export a CSV
  instead", so roughly **34 routes show unflagged gap language to a demo audience regardless of
  `SHOW_GAP_NOTES`**. If the flag's purpose is to keep gap language away from an audience, this is
  the hole in it.
- **`lib/gaps.ts` is entirely dead code.** Its header says so: every leaf path in `nav.ts` now has
  a real screen, so the `[...slug]` catch-all never renders a `GAPS` entry. Kept deliberately for
  the next nav path added ahead of its screen.
- **Zero `TODO`/`FIXME`/`XXX` markers** in `apps/organizer/src`. One `readOnly` input
  (`engagement/speed-networking/page.tsx:164`, intentional). Every `<form>` on a non-writing screen
  is `method="get"` — there are **no unwired submit handlers anywhere**.
