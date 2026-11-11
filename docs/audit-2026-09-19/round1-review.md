# Dashboard at 390
I ran all 215 dashboard routes at 390 wide and nothing is broken at the page level. Every route returned 200, none scrolls sideways and none logged a console error. Screenshots and metrics are in `/private/tmp/claude-501/-Users-hartigan-Documents-Claude-Projects-KGC/ce473dc2-4864-489c-bc7b-43704d7578c0/scratchpad/audit/out/after-dash/`.

I changed no repo files and added nothing to `handoff.md`; I wrote a few helper scripts next to the screenshots in the out folder. The first attempt ran three batches in parallel and the logins timed out, so I re-ran every batch one after another. Two batches held stale metrics from the killed run, so I deleted those and re-ran them. The numbers below come from the clean run.

**Metrics over 215 routes**
- Status not 200: none.
- horizontalScroll true: none.
- consoleErrors non-empty: none.
- Broken images: none.
- One redirect: `/pay/order-details` goes to `/tickets/orders-and-transactions/attendee-orders` and returns 200.
- overflowing non-empty on 13 routes. Every flagged element is a `.whova-table-header` cell sitting past the right edge inside a table. On tables with rows the body scrolls sideways. On empty tables the hidden header columns cannot be reached, which does no harm. The routes:
  - `/attendees/check-in-and-checkout/check-in` (Ticket, Station, Registration, Device, Code)
  - `/attendees/check-in-and-checkout/self-check-in` (Station)
  - `/attendees/check-in-and-checkout/checkout` (Ticket, Station)
  - `/content/speaker-center/message-speakers`, `/content/exhibitor-center/message-exhibitors`, `/content/sponsor-center/message-sponsors` (Result)
  - `/marketing/event-webpages/agenda-webpage/analytics` (Orders, Net)
  - `/tickets/ticket-setup/create-group-tickets` (Total, Status)
  - `/tickets/ticket-setup/1-6-abandoned-registration` (Amount, Marked cancelled)
  - `/tickets/exhibitor-ticket-setup/2-2-question-forms`, `/tickets/sponsor-ticket-setup/question-forms` (Answers)
  - `/tickets/exhibitor-ticket-setup/2-6-offline-payment` (Amount, Recorded by)
  - `/tickets/payout` (unnamed last column)
- Clean by metrics: 201 routes (202 if the redirect counts as clean).

**What I looked at**
About 60 screenshots across every section, including all 6 check-in screens: the hub, check-in, session-self-check-in, kiosk-check-in, self-check-in and checkout. Tall pages were cropped and tiled into contact sheets in `out/after-dash/crops/s1.png` to `s17.png`.

Fixed and looking right on a phone:
- The side menu collapses to a "MENU" bar and content takes the full width.
- The event header stacks and page-header tags, links and buttons wrap.
- Check-in: the scan box, READY panel and row Check in buttons all fit. The developer notes on the check-in page and the essay pages (Self Check-in, Checkout) are gone.
- Projects & Checklists rows, name badges, the downloadable-graphics sign, the raw SVG dump, community board posts and the message-speakers confirm inputs.
- Standalone empty states; the ones inside tables still break, see item 1.

**Remaining problems**
In the list below, paths starting `crops/` sit under the out folder and other png names sit directly in it.

1. **Empty state drawn over the table.** On 8 routes the "Nothing here yet" box is narrower than the table and sits on top of the column headers, leaving stray vertical strips on both sides:
   - `/content/speaker-center/message-speakers`, in both "Who gets this" and "Recently sent": `crops/content_speaker_center_message_speakers-390-1650.png`
   - `/content/exhibitor-center/message-exhibitors` and `/content/sponsor-center/message-sponsors`: same form, not viewed
   - `/tickets/ticket-setup/create-group-tickets` and `/tickets/exhibitor-ticket-setup/2-6-offline-payment`: `crops/s9.png`
   - `/tickets/exhibitor-ticket-setup/2-2-question-forms`, `/tickets/ticket-setup/1-6-abandoned-registration` and `/marketing/event-webpages/agenda-webpage/analytics`: `crops/s10.png`
   - Probably any table that uses the icon empty state. Plain-text empty tables such as check-in and payout are fine.
2. **Unstyled form controls.** Inputs and selects are about 20px tall and hard to tap:
   - `/tickets/exhibitor-ticket-setup/2-6-offline-payment`, the whole Record a payment form: `crops/s9.png`
   - `/tickets/exhibitor-ticket-setup/2-3-booth-selection`, Allocate a space: `crops/s12.png`
   - `/attendees/admin-settings`, the Check-in staff input: `crops/s2.png`
3. **Overlapping text** on `/virtual-and-hybrid/online-session-manager/rehearsal-sessions`. In "busy" rows "until 09:00" runs into the Talk column ("until 09:00Lessons from a s"). The page is 7,512px tall. `crops/s15.png`
4. **Wide tables hide columns behind a swipe.** The only cue is a fade on the right edge:
   - `/engagement/1-1-meeting-scheduler`, `/engagement/round-table` and `/engagement/session-feedback`: the When column and the row actions (Edit, Cancel, Results) start off-screen. `crops/s5.png`
   - `/tickets/ticket-setup/1-1-create-tickets`: the price is half cut ("$1,199") and the row actions are off-screen. `crops/s11.png`
   - `/tickets/payout`, "Why sold and paid out differ": whole sentences sit in a scrolled column and are cut mid-line. `crops/s9.png`
   - `/attendees/manage-attendees/attendees`: two columns show, emails break mid-word and titles clip ("Head of Knowledge Engineerin"). `attendees_manage_attendees_attendees-390.png`
5. **Blank tall rows** on `/tickets/ticket-setup/1-3-confirmation-emails`. Recent sends rows are about 140px tall and mostly empty because a hidden long column wraps. `crops/s11.png`
6. **Developer wording still on screen:**
   - `/marketing/event-website`: tiles read "9 need the developer", "DATA PROBLEMS 38" and "not inputted yet", and the table has a raw Path column. `crops/s7.png`
   - `/marketing/event-webpages/agenda-webpage/general-purpose`: tag "1 things to fix" and a column headed "Records". `crops/s7.png`
   - `/content/agenda-center/track-manager`: an "Id" column of slugs. `crops/s4.png`
   - `/tickets/ticket-setup/1-1-create-tickets`: monospace slugs under each ticket ("all-access", "main-conference"). `crops/s11.png`
   - `/attendees/check-in-and-checkout/kiosk-check-in`: a "Device id" column. `crops/attendees_check_in_and_checkout_kiosk_check_in-390-560.png`
   - `/content/speaker-center/message-speakers`: "137 records have no email address". `crops/s4.png`
   - `/content/basics`: "Event ID kgc-2027" and "America/New_York". `crops/s3.png`
   - `/publish`: "still render last edition's built-in text". `crops/s14.png`
   - `/content/project-management/projects-and-checklists`: task notes in the live data read "SETUP-PAYMENTS.md section 4" and "Question Forms is unbuilt". This is data, not code. `crops/s16.png`
7. **Em dashes in copy the user reads.** The metrics count em dashes on 29 routes. Most are seed data, plus at least one line of interface copy.
   - Interface copy: `/engagement/round-table` has "No host yet — ask the programme committee." `crops/s5.png`
   - Highest counts are traffic-analytics 14, transaction-history 12 and venue-map-webpage 8. I did not check whether those are interface copy or data.
   - Seed data with em dashes was seen on 1-1-meeting-scheduler, session-feedback, discussion-topics and community-board.
8. **Small layout slips:**
   - On check-in and kiosk, the "Check in / Start camera" buttons touch the "This station's name" label with no gap.
   - On check-in, the "Check-in for the session" block sits 1 to 2px right of its siblings.
   - On session-self-check-in, the Station name input is only about 170px wide and clips "Tata Innovation Cent".
   - On nearly every page, stat tiles butt against the page-header card with no gap. `crops/attendees_check_in_and_checkout_check_in-390-560.png`, `crops/attendees_check_in_and_checkout_session_self_check_in-390-560.png`
9. **Small tap target** on `/tools/moderator-tools/community-board`: the Hide links are 12px text. `crops/s13.png`
10. **A lot of chrome before the content.** Every screen opens with about 600px of shared header: masthead, stat cards, section tabs, Live Event Stats and the menu bar. Page content starts below the first phone screen. `crops/s17.png`

The round black "N" badge in every screenshot is the local dev-server overlay, not part of the dashboard.

Clean route count: 201 of 215 by metrics. By eye, I found nothing worth listing on about 30 of the 60 or so pages I viewed.

# Desktop and website
I changed nothing. Both checks ran. The desktop comparison found two visible issues to fix and a few changes to confirm. The website has no sideways scroll on any route at 375 or 768, and only two clipped placeholders.

## (a) Desktop at 1280, 25 routes, local after-fix vs a fresh live capture

- After-fix shots: `/private/tmp/claude-501/-Users-hartigan-Documents-Claude-Projects-KGC/ce473dc2-4864-489c-bc7b-43704d7578c0/scratchpad/audit/out/after-dash-1280/`
- Live shots of the same routes, taken in the same run: `.../audit/out/live-1280/`
- Side-by-side images (live on the left, after on the right): `.../audit/out/cmp-1280/<slug>-1280.png`. Content-area stacks are in `cmp-1280/v-<slug>.png`.

**Identical**, pixel diff limited to the Netlify badge and the Next dev indicator (8 routes):
- /content/speaker-center
- /marketing
- /marketing/whova-listing
- /pay
- /tools
- /tools/admin-control
- /virtual-and-hybrid
- /tickets/orders-and-transactions

**Changed only in ways the audit asked for** (copy, data, badge and button styling; layout, nav and titles are the same):
- NEW/HOT/STEP badge rendering is fixed (it was garbled on live): /attendees, /content, /engagement, /tickets, /attendees/check-in-and-checkout.
- Copy is trimmed: /attendees/segments (now also shows real ticket and company data), /content/agenda-center/session-manager, /tickets/exhibitor-ticket-setup/discount-codes, /tickets/attendee-customization/attendee-categories, /marketing/social-media-center/content-library, /publish, /content/documents-and-videos/documents.
- Main-action buttons that rendered as plain text are now filled or outlined: /engagement/surveys, /content/documents-and-videos/documents, /content/sponsor-center/sponsor-manager, /publish, /marketing/social-media-center/content-library, /tickets/attendee-customization/attendee-categories, /tickets/ticket-setup/1-2-question-forms.
- The audit named this button problem for engagement and virtual-and-hybrid; it has now been applied everywhere.
- I did not open /engagement/live-polling individually. Its diff was 1.0%, the same as /engagement/surveys.

**Desktop changes the audit did not ask for, or that need fixing:**

1. **/tickets/ticket-setup/1-2-question-forms: the "Ask only on" multi-select is now clipped.**
   - It is about 40px tall. It shows two options and half of a third; live showed four rows.
   - Cause: `className="whova-text-input"` on the `<select multiple>` at `apps/organizer/src/app/(dash)/tickets/question-form-editor.tsx:167`. `.whova-text-input` sets `height: 40px` at `apps/organizer/src/app/globals.css:1257`. It needs `select[multiple].whova-text-input { height: auto }`.
   - This is the only multi-select that uses the class.
   - Crop: `.../cmp-1280/crop-qf-select.png`. Full: `.../cmp-1280/tickets_ticket_setup_1_2_question_forms-1280.png`.
2. **Same screen: the row actions in the question table changed layout.**
   - Live stacked Edit, Move up and Remove vertically.
   - They now run inline and wrap ("Edit Move up" on one line, "Remove" on the next), and the Answers column sits further right.
   - No audit issue asked for this. Same PNG.
3. **Same screen: the "Orphaned answers" stat label is now "Answers to removed questions".**
   - It wraps to two lines, so that stat card is taller than the other three. Minor. Same PNG.
4. **/engagement/surveys: two filled blue buttons now show at once.**
   - "+ New survey" in the header and "Create the first one" in the empty state are both primary. The audit asked for one main action per screen.
   - "Create the first one" now sits directly under the "No surveys yet" heading with no gap.
   - PNG: `.../cmp-1280/v-engagement_surveys.png`.
5. **/virtual-and-hybrid/attendance-gamification: two things were removed.**
   - The info "i" icon beside the title is gone, and so is the "See attendance without a score" button.
   - This is probably the intended essay cut, but it is a visible change to the desktop header. Please confirm.
   - PNG: `.../cmp-1280/v-virtual_and_hybrid_attendance_gamification.png`.
6. **/content/sponsor-center/sponsor-manager: "Add sponsor" now appears twice as a blue button.**
   - One is in the header and one is in the toolbar under the tabs. Live also had both, but the header one looked like plain text, so it is only obvious now.
   - Also present on live: the long contact email (`events@processtempo.example.invalid`) overlaps the Booth column on the last row.
   - PNG: `.../cmp-1280/content_sponsor_center_sponsor_manager-1280.png`.

## (b) Website, all 25 routes at 375 and 768

- Shots and metrics: `.../audit/out/after-web/` (`<slug>-375.png`, `<slug>-768.png`, `metrics-375-a/b.json`, `metrics-768-a/b.json`).
- Contact sheets of the 375 shots: `.../audit/out/after-web/sheets/s00.png` to `s15.png` (80 segments).

**Sideways scroll:** none. `docScrollWidth` equals the viewport on all 50 shots. The only elements flagged as overflowing are the home ticker (`div.ticker-track`), which is a marquee inside a clipped container and does not scroll the page.

**Clipped content:**
- /tickets/invoice at 375: two input placeholders are cut off, "accounts-payable@company.cc" (Billing email) and "VAT ID, cost centre, departmen" (Note on the invoice). PNG: `.../after-web/tickets_invoice-375.png`, or `sheets/s15.png`.
- The other clipped hits in the metrics are `sr-only` labels, which is expected.

**Looks wrong in the full-page shots but is not a real problem.** I checked these in a live 375x844 viewport with `verify-web-probe*.mjs`:
- Blank sponsor logos, blog thumbnails, team photos and agenda avatars are lazy-loaded images. They load once scrolled into view and there are no broken images. Proof: `after-web/probe-home-sponsors.png`.
- The white band under the footer on / and /tickets1, and the stray header at the bottom of /agenda, are stitching artefacts from the full-page capture. In the live viewport the footer bottom equals the document height.

**Other observations** (no files under `apps/web` differ from HEAD in the working tree, so none of these come from uncommitted edits):
- The small "KGC" mark at the top of the footer (`/kgc-mark.png`, 42px) is dark blue on navy and nearly invisible on every page. PNG: `after-web/probe-footer.png`.
- On localhost, /tickets/checkout, /tickets/exhibitor and /tickets/sponsor show a "Skip payment and register (demo)" block. Its text names `scripts/ops/reset-demo-sales.mjs` and lists internals. It says "Localhost only", so check that it never renders in production. PNGs: `sheets/s13.png`, `sheets/s14.png`.
- /agenda at 768 shows the day chips twice: a labelled DAY row, then a second unlabelled row of days under TRACK. PNG: `after-web/sheets/w768.png`.
- Seeded content has em dashes: the announcement "Moved to Bloomberg 165 — bigger room" on /announcements, and the document title "Venue map — Bloomberg Center" in the dashboard. This is seed data, not a layout matter.
- /documents lists 1 document, while the dashboard shows 4 published with 1 restricted. It may be filtering the `example.invalid` links. This is a data question, not layout.
- With the cookie banner undismissed, the Next dev overlay pill covers the "Got it" button at 375. This happens in dev only.

No files in the repo were edited and nothing was added to handoff.md. The only files I created are helper scripts in the audit scratchpad: `run-dash25.sh`, `run-web.sh` and `verify-web-probe{,2,3}.mjs`.

# Diff review
I found no blocking issues, and the `listAttendees` change is a real root-cause fix. I reviewed only and changed no files; the one thing to fix before committing is an untracked file that tracked code imports (finding 1).

**What I checked**
- `npx tsc --noEmit` passes in `apps/organizer`, `apps/web` and `app`.
- `vitest` passes for `tests/programme`, `app/src`, `scripts/src`, `packages/shared`, `tests/qr` and `tests/parity` (516 tests).
- No files or tests were deleted. Nothing changed in `packages/`, `functions/`, `firestore.rules`, or organizer `lib/` apart from the attendee join.
- No secret values appear in the diff.
- Purchase and auth logic is untouched. The diffs in `apps/web/src/app/tickets/actions.ts`, `apps/web/src/app/tickets/invoice/actions.ts`, `apps/web/src/app/tickets/checkout-form.tsx`, `app/src/app/login.tsx` and the 12 organizer `actions.ts` / `import.ts` files are message strings only.
- I screenshotted three dashboard pages at 1280 and opened `/attendees/manage-attendees/attendees`. It shows 52 rows with real names, companies and tickets, and no horizontal scroll. I did not open the billing or transaction-history shots, and took nothing at 390.

**The `listAttendees` fix**
- File: `apps/organizer/src/lib/data.ts:580-593`, with the merge moved to the new `apps/organizer/src/lib/attendees-core.ts`.
- The merge base projected both queries with `.select('email')`. Every other field read as undefined, so rows showed no name, no company and no ticket.
- The fix drops the projection and extracts the merge into a pure function. `tests/programme/attendees-core.test.ts` pins it and runs under `npm test`.
- The one behaviour change is `r.name ?? '(no name yet)'` becoming `||` at `attendees-core.ts:97`, which is harmless.
- Pre-existing and not addressed: when one email has two registrations the last one wins, so a cancelled ticket can hide an active one (`attendees-core.ts:78-86`).

**Findings, most severe first**

1. **Medium: untracked file imported by tracked code.**
   - `apps/organizer/src/app/(dash)/tickets/wrap-col.tsx` is untracked.
   - It is imported by `tickets/orders-and-transactions/transaction-history/page.tsx:18`, `tickets/payout/page.tsx`, `tickets/publish-tickets/page.tsx`, `tickets/audience-registration.tsx`, and the `event-listing`, `event-website` and `social-sharing` pages under `tickets/ticket-marketing/`.
   - If a commit leaves it out, the build breaks.

2. **Medium: data filtering added inside website layout work.**
   - `apps/web/src/lib/data.ts:404,482-495`: a new `isRealName` drops speakers from the agenda map and from `speakerNames`. It hides the bad roster record "(Phil) (Meredith)" rather than fixing it, and `speakerIds` stays unfiltered.
   - `apps/web/src/app/documents/page.tsx:70-72`: a host regex filters documents out of the page. The host line under each document is also removed, so visitors no longer see where an external link goes.

3. **Medium: logic change in the mobile app, still uncommitted.**
   - `app/src/lib/data/community.ts:158-160` now filters replies by `status` on the client.
   - The intent is reasonable, but hidden and removed replies are still delivered to the device, so this only hides them on screen.

4. **Medium: desktop changes on the dashboard, which the rules say should not move.**
   - `apps/organizer/src/app/globals.css:1001-1038`: bare `.whova-btn-main` now has a blue fill, white text and a hover colour.
     - This affects about 22 usages, including 5 `small` ones.
     - An audit issue at 1280 asked for it (ui-issues.md:112), but some screens may now show two primary-looking buttons.
   - The `Table` was replaced with div rows at every width to fix a 390-only issue.
     - Confirmed at `pay/billing-information/page.tsx:106-130`.
     - `pay/publish/page.tsx` and the `session-rsvp` and `session-chats` pages dropped their `Table` import too, so the same swap probably applies there; I did not read those diffs.
   - `apps/organizer/src/app/(dash)/dash-nav.tsx` wraps the sidebar in a new `.rail-body` div. No selector depends on the old structure, so it looks safe.

5. **Medium-low: information an organizer needs was removed.**
   - The line saying which database you are writing to was removed from `login/page.tsx:21`, `content/basics/page.tsx`, `content/basics/website-copy/page.tsx` and `tools/report/page.tsx`. It now appears only on `apps/organizer/src/app/page.tsx:95`.
   - `attendees/manage-attendees/analytics-and-exports/page.tsx:191-192`: the "What it is for" and "Columns" columns are hidden on phones. This is a personal-data export screen, and the banner above tells the user to pick the smallest export.
   - `tickets/question-form-screen.tsx:292`: the note that re-adding a question with the same id reconnects its old answers is gone.
   - `app/src/app/(tabs)/me/badge.tsx:149`: the advice on what to do if someone else was already checked in with your code is gone.
   - `apps/web/src/app/tickets/sponsor/page.tsx:37` and `apps/web/src/app/tickets/exhibitor/page.tsx:28`: the dates and venue are gone from the lede.

6. **Low-medium: copy claims that may not be true.**
   - "Ticket sales open soon" and "Invoicing opens soon" appear at `apps/web/src/app/tickets/actions.ts:340`, `apps/web/src/app/tickets/invoice/actions.ts:43`, `apps/web/src/app/tickets/checkout-form.tsx:233` and `apps/web/src/app/tickets/invoice/page.tsx:48`.
     - The real state is that no Stripe key exists. The invoice page still shows its full form underneath the notice.
   - The inserted string lines at `tickets/actions.ts:340` and `tickets/invoice/actions.ts:43` also have broken indentation.
   - The duplicate-name error now reads "is already on the list under a name this close", and the conflicting id is no longer shown. The organizer cannot find the record that clashes. This is in 5 organizer `actions.ts` files, for example `content/agenda-center/track-manager/actions.ts:97`.

7. **Low: desktop changes on the website.**
   - The FAQ triple-glyph marker was removed at all widths (`apps/web/src/app/globals.css:3457-3462`).
   - Exhibitor tiles now show initials instead of the full name (`apps/web/src/app/exhibitors/page.tsx:121-126`).
   - `.exhibitor-zone` has `padding: 0` and `nav.tags a.tag` has `min-height: 36px` at every width.

8. **Low: signs that parallel agents made uncoordinated edits.**
   - The em dash placeholder was changed to "-" in some files (`attendees/check-in-and-checkout/check-in/page.tsx`, `scanner.tsx`, the `session-self-check-in` page) and left alone or newly added in others (`tools/report/page.tsx:203,330`, `engagement/announcements/page.tsx`, `publish/page.tsx`, the orders `summary` page, the `referral-contest` page).
   - `ROW_ACTION` is defined three times, and `dayLabel` is defined twice with different locales (en-GB in `tools/report`, en-US in the `rehearsal-sessions` page).
   - Check-in list names are rewritten at render time with `name.replace(' — ', ': ')` in the `check-in` and `kiosk-check-in` pages only. The `checkout` and `self-check-in` pages still show the stored name.
   - `shortEmailError` in the `transaction-history` page (line 58) matches `/not set|unset/` against any skipped reason, and the raw error text is kept only for failed sends.

9. **Low: test fixtures out of step with the seed.**
   - The uncommitted `scripts/src/seed-demo.ts:650` renames the survey to "Opening session: your feedback".
   - `app/src/lib/data/surveys-core.test.ts:40` and `tests/rules/firestore.test.ts:202` still use the em dash title.
   - These are separate fixtures, so nothing fails.
   - Email subjects also changed in `scripts/src/lib/email.ts:345,407`, which no test asserts.

10. **Low: passphrase in a committed script.** `docs/audit-2026-09-19/shot.mjs:38-39` hardcodes the demo login and the passphrase `kgc2027`. The same value is already in `AGENTS.md` and `DEMO-SCRIPT.md` on the base branch, so this is not a new exposure, but AGENTS.md describes it as the live passphrase.

**What I did not do**
- Most of the ~240 dashboard diffs were not read line by line. I scanned them for non-copy lines (imports, `const`, `await`, `if`) and found nothing beyond the items above.
- The emulator-backed suites (rules, functions, commerce) were not run.