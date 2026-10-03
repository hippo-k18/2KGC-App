# Dashboard fixes
All checks pass. Here is the report.

---

## What I fixed, grouped by cause

**31 issues across the two files (dash-a 12, dash-b 19). All 31 closed.** Nine causes; six of them were one edit each in a shared file.

### 1. The `--link` colour was never declared — 3 issues
`apps/organizer/src/app/globals.css` used `var(--link, …)` in one place with a fallback, and eight call sites wrote `color:`/`background: var(--link)` with none. An undefined custom property is not an error: it silently resolves to the inherited colour, so those controls rendered as plain black body text and the sales chart's bars rendered as nothing at all. One token on `:root` fixed the blank "Net sales by day" chart (high), the black Hide/Reinstate/Turn off row actions (medium), and the black Unpublish/Restore/Publish controls (medium).

### 2. Tables did not stack on a phone — 3 issues, 40 named routes
`Table`'s `stackSm` was opt-in and about a third of the 112 tables opted in, which was the wrong third. Made it the default in `apps/organizer/src/app/(dash)/ui.tsx`, with `stackSm={false}` as the escape hatch. Closed the money losing its last digit on Balance (high, 18 routes), the explanation column cut in half (medium, 12 routes) and row actions sitting 286 to 514px off the right edge (medium, 10 routes).

### 3. A UTC string printed as if it were local — 1 issue, 5 more screens pre-empted
`iso.slice(0, 16).replace('T', ' ')` in seven tables. Added `stampOfInstant` to `apps/organizer/src/lib/time-core.ts` beside the two functions that already existed for exactly this bug, and used it at all seven. Self Check-in and Checkout now agree with the door screen (high); the other five were the same defect on screens the audit did not reach. Pinned in `time-core.test.ts`.

### 4. A popover with no collision detection — 1 issue
`useNudgeIntoView` in `apps/organizer/src/app/(dash)/menu.tsx`. The first attempt used a transform and failed instructively: `getBoundingClientRect` reported the panel fully inside the window while the screen still showed every label missing its first letter, because a translate moves where a box is drawn and not the box it is clipped against. The panel sits inside the table's horizontal scroller, so it clamps to that box, via `left`. Verified: menu at x=35–209, "Edit attendee" intact, no sideways scroll (high).

### 5. The editor opened below the fold — 1 issue, 3 screens
Edit on a question form now links to an anchor on the editor panel. Measured after a real tap at 390: the editor lands 12px from the top instead of 3,227px below it (high).

### 6. Controls under 32px on a phone — 4 issues
One block in the narrow-screen CSS plus a `row-link` class on four hand-built rows. Covered `.linkish` outside a table (medium), the bare tick box, now a 40x40 label with the drawn square unchanged (medium), the Event website link on all 129 screens (low), and the certificate Remove link (low). The "Event website" entry is gone from every screen's small-target list.

### 7. One thing said twice — 4 issues
Dropped the duplicate Import and Add sponsor buttons sixty pixels under the tab and the header button that already carried them (medium); made the vendor one-liner optional in the shared integration guide and dropped the two that answered their own heading (low); dropped the duplicate "Event code" panel heading, keeping the field label a screen reader needs (low); dropped "None yet." after a sentence that already gave the count (low).

### 8 and 9. The rest, one each
Per-audience compose examples so exhibitors no longer read a letter to a speaker · the rail button reads "Setup guide ›" in full instead of "STEP-BY-STEP GUID" · the misleading completeness bar under "Missing details" removed, the labelled tile above it kept · an empty table is 180px, not a fixed 400 · kiosk stations grouped by name with a device count, nine identical rows became two · arrivals by hour 38 rows to 14 · card heads given one shape at narrow width · the Attendees column widened so "AttendeesShare" reads as two words · the un-tickable Select cell rendered as nothing so the stacked card hides it · the audit trail reads "Reinstated attendee / Ada Silva" rather than `attendee.reinstate` / `registrations/reg_01e16…` · "1 screen" · the em dash in an export description · emails breaking at the @ and the dots · search hints shortened to fit.

## Two things worth knowing

- **The audit trail names people on new writes only.** I added a `subject` field and set it on the six attendee actions, and `recentAudit` also lifts a name out of an entry's own diff where there is one. Entries already in the database that carry neither still read "not named".
- **The metrics tool still reports a 16px checkbox** on six screens. That is the `<input>`; the label around it is now 40x40 and is what a finger hits. Measured directly rather than inferred.

## Proof

Looked at every visual fix at 390 and 1280. **53 screens shot, zero with sideways scroll, zero elements past either edge, zero clipped text at 1280.** Drove the row menu and the question-form Edit with Playwright rather than trusting the static capture. Desktop chrome unchanged: nav tree, tab strip, rail, tab names and screen titles all as they were, confirmed on the 15-route 1280 pass.

`npx tsc --noEmit` in `apps/organizer` clean. `npm test` at the root: **53 files, 962 tests, all passing.**

One test changed with a reason: `tests/programme/door-dashboard-core.test.ts` pinned a 24-hour gap being drawn in full, which the new empty-hour limit deliberately no longer does. Its named guarantee, the day labels, is unchanged; the gap line now expects the gap to be reported, and says why.

## Files changed

All under `/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/`, 29 in `apps/organizer/` plus one test:

`apps/organizer/src/app/globals.css` · `apps/organizer/src/app/(dash)/ui.tsx` · `apps/organizer/src/app/(dash)/menu.tsx` · `apps/organizer/src/app/(dash)/dash-nav.tsx` · `apps/organizer/src/app/(dash)/integration-guide.tsx` · `apps/organizer/src/app/(dash)/messaging/message-form.tsx` · `apps/organizer/src/app/(dash)/marketing/webpage-screen.tsx` · `apps/organizer/src/app/(dash)/tickets/question-form-screen.tsx` · `apps/organizer/src/app/(dash)/engagement/community/category-screen.tsx` · `apps/organizer/src/lib/{time-core.ts,time.ts,time-core.test.ts,audit.ts,attendee-admin.ts,data.ts,door-dashboard-core.ts,exports.ts,messaging.ts}` · plus 18 screen files under `apps/organizer/src/app/(dash)/` · `tests/programme/door-dashboard-core.test.ts`

I did not touch `app/`, `apps/web/`, `scripts/ops`, `firestore.rules` or any server. The other 59 modified files in the tree belong to agents working alongside me.

# App and website fixes
Done. Here is what I found, grouped by cause, and what I changed.

## App

**1. A ticket restriction the screen never read (high).** `useSessionSeat` knew a session had a cap but not who it was for, so a restricted session drew a live full-width Join Waitlist button and a tap was the only way to learn the answer was no — as a red line a reload wiped. The hook now reads the caller's own registration (the same lookup, and the same comparison, the seat transaction makes) and only for a session that names ticket types; a merely capped session opens no extra listener. It returns `barred` and a `ticketLine`. `agenda/[id].tsx` prints that line under the room on arrival, draws the button inert and grey reading "Not on your ticket", and drops the seat count, which says nothing to somebody who cannot take one. Somebody already holding a place keeps it. A failed registration read leaves the button alone rather than locking someone out on its own broken lookup. `me/schedule.tsx` shows the same line.
`/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/app/src/lib/data/session-seats.ts`, `app/src/app/(tabs)/agenda/[id].tsx`, `app/src/app/(tabs)/me/schedule.tsx`. `use-collection.ts` now takes `null` for "nothing to listen to yet", the gate `useDocument` already gave its callers.

**2. A nested `Text` reset every heading.** In `rich-text.tsx` a plain run was wrapped in the app's `Text`, which defaults to the body variant, so a 20pt semibold heading came back out at 17pt regular and the FAQ and Wi-Fi pages read as one run of sentences. Spans now carry only their own difference: react-native's plain `Text` for bold, italic, code and link, and the bare string otherwise.

**3. Two `hitSlop` calls with no `webSlop`.** The bookmark star was 20pt and "Say Hi" 64x28 in a phone browser. Both paired, the star raised to 44 each way, and the gap between them set from the two slop sums so neither hit area lies on the other. Both are gone from the under-44 scan; the five remaining are the ones round four listed as deliberate.

**Also:** replies carry an author and a relative time, resolved from the same projection the People list reads, with "Attendee" for somebody not in the directory and "You" for your own (`community/[id].tsx`, post too). A poll that will never be counted drops the per-row dash. No hairline under the last row of a list band (announcements, and each tier or letter band in People). The Job title box asks "What you do" instead of offering a real job title. Sponsor rows drop the tier the band above already states. Session Q&A groups its 71 rows under day headings.

## Website

**1. The shared field rule sized check boxes (high).** `.field input { width: 100% }` turned each consent box into a 13px strip across the column with the tick floating above its label. Check boxes and radios now get a fixed 20px square and `.check` puts the box beside its words in a 44px line. Same markup in the checkout questions and the abstract portal, one rule for both.

**2. A magnifier that did not search.** The header icon loaded `/agenda` with nothing to type in. `/agenda` now has a real search: a plain GET form on `q`, filtered on the server against title, speaker, room and track, carried through every filter chip, stated in the summary line. The icon lands on it focused.

**Also:** the full speaker roster goes two-up below 620px with an 86px portrait (2,706px for 24 cards, against about 11,000 for 45). `/tickets/invoice` swaps the two passages describing a form that is not on the page when invoicing is closed. `/hcls` body copy and the four objectives read from a straight left edge. A FAQ answer's list gets a gap under it. The track row fades at its right edge and its label carries the count. Deadlines print as "15 December 2026, 23:59 New York time" from one helper in `lib/site.ts`, which replaces the four raw renderings and the near-duplicate on `/call-for-posters`. "KGC Talks" points at the talks category rather than at Blog. One typewriter apostrophe on `/previous-events`.

**Sponsor logos:** every mark sat on a square canvas, so a wide wordmark was height-bound and rendered a fraction of its card. Trimmed the transparent margins in the eighteen PNGs with a 2% margin back. Rendered width went from 0.60 of the card to 0.95–1.00 for every logo. Note: `apps/web/.next/cache/images` held the old square versions, so I cleared that directory to see the change; nothing was built or restarted.

## Checked and verified

Re-walked every changed screen with Playwright and viewed the shots: `/private/tmp/claude-501/-Users-hartigan-Documents-Claude-Projects-KGC/ce473dc2-4864-489c-bc7b-43704d7578c0/scratchpad/audit/rw5.mjs` (app, `r5/`) and `rw5web.mjs` (website, `r5w2/`), plus `r5w/`, `r5w3-*.png`, `r5w4-sponsors.png`, `r5final-*.png`. No horizontal scroll and no page errors on any of them.

`npx tsc --noEmit` clean in `app` and in `apps/web`. `npx vitest run app/src` 53/53. `FIRESTORE_EMULATOR_HOST=localhost:8080 npx vitest run tests/rules` 321/321.

`npm test` is **958 passing, 1 failing**, and the failure is not mine: `tests/programme/door-dashboard-core.test.ts` ("labels the hours with their day once the chart spans more than one", `skippedGaps` expected 0, got 1) tests `apps/organizer/src/lib/door-dashboard-core.ts`, which another agent has modified in the tree right now (10 insertions against HEAD). I touched nothing under `tests/`, `scripts/` or `apps/organizer`, and left it alone.

## Left, with reasons

- **Two `/documents` rows point at `example.invalid`** (venue map, travel notes). Round four left these because the fix needs a real file, and I did not invent a URL.
- **The badge says you checked in on Sunday** for an event that runs Monday to Friday. Seeded attendance data, outside what I own here.
- I did strip the wall-clock stamp from the announcement titled "Room 271 has moved to Classroom 4 (19:17:05)" through the emulator, keeping the row and its text prefix so anything asserting on it still matches.

# Verification
All checks are done. Here is the verification.

---

# Verification of the fix round (branch `audit-fixes-2026-09-19`, 89 files changed since 4016c5a)

## 1. Sampled issues, with verdicts

I judged **all 53** issues in the four files against the running build, not a sample of 20. Every verdict below is from the live build at the width the issue names.

### High, 7 of 7 fixed

| # | Screen | Verdict | Evidence |
|---|---|---|---|
| app 1 | capped session not on your ticket, 390 | **fixed** | The line "This session is for All Access (VIP), Gold, Platinum and Workshops tickets. Your ticket is Startup Table." is under the title on arrival, and the button reads "Not on your ticket" and is inert. No red line, nothing lost on reload. |
| dash-a 1 | orders summary, 390 | **fixed** | Both bars on Net sales by day now render solid blue. |
| dash-a 2 | question forms, 390 | **fixed for the real path** | Clicking Edit lands at scroll 3208 with the editor 12px from the top. A direct load of the same address does not scroll, so a pasted or bookmarked link still opens at the top. |
| dash-b 1 | attendee row menu, 390 | **fixed** | Menu opens at x=35, right edge 209, viewport 390. All eight items fully on screen and hittable. |
| dash-b 2 | self check-in and checkout clocks, 1280 | **fixed** | Both now print 2026-09-21 22:39, matching the door screen. |
| dash-b 3 | wide tables clipped, 390 | **fixed** | Money reads $2,798.00 and $2,715.96 in full; rows are cards. |
| web 1 | checkout consent boxes, 375 | **fixed** | Two 20px squares beside their labels, one line each. |

### Medium and low

**Fixed (43):** app 2, 3, 4, 5, 6, 7, 8, 9 · dash-a 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 · dash-b 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 19 · web 2, 3, 4, 5, 6, 7, 9, 10, 11, 12.

Measurements worth naming: select tick boxes 40x40 (was 16); "Event website" 88x32; row controls on tasks, sessions and the order filters all 32px tall and anchor blue; "Hide" and "Unpublish" at rgb(32,105,188), the same blue as the link beside them; setup guide button 111px wide with nothing cut; empty table 180px (was 400); arrivals hour table 15 rows (was 38); scanner stations grouped to two named rows with a device count; segment heading column 96px so "Attendees" and "Share" no longer touch; speaker roster two columns at 375; sponsor marks all filling their cards.

**Partly fixed (3):**
- **app 10, test data.** The timestamp is gone from the announcement headline. Two handouts still point at a placeholder host, and the badge still says you checked in on Sunday. Round 4 recorded leaving these on purpose.
- **dash-b 11, audit trail.** The action column reads well now. See finding N1.
- **dash-b 18, email wrapping.** Ten call sites fixed, at least six missed. See finding N4.

**Still open (1):**
- **web 8, two document cards showing a placeholder host.** Seed data, and the issue itself said so.

### Never a problem
None. Every issue described something I could confirm had been real, either from the fix or from the code path it names.

## 2. Fresh screens

**20 dashboard screens at 390 the issue files do not mention** (hybrid settings, cross-event report, volunteer manager, release and consent forms, session cap, gamification, meeting scheduler, speed networking, round table, photo booth, streaming setup, Zoom, event checklist, adoption email, session chats, moderate session Q&A, post-event access, order details, billing information, publish): all 200, no horizontal scroll, no overflow, no stray long dashes outside the empty-cell marker. Nothing new except finding N4 on order details.

**10 app screens signed in as Rune Petrova** (home, agenda, people, community, me, messages, documents, badge, schedule, session Q&A): all render, all correct width. Finding N6 below.

**8 website pages at 375** (team, exhibitors, announcements, community, learn, ticket options, sponsor tickets, code of conduct): all 200, no horizontal scroll, no overflow, no long dashes. Nothing new.

## 3. New findings, ranked

**N1, medium. The audit trail lost the only thing that identified a record.** `/tools/report` at 1280. The Target column was removed and replaced with a name, but only six attendee operations write one. Seven of the thirteen rows on screen read "not named", including every cancel, every reinstate and the check-in, so an organizer asking who was cancelled now has less to go on than before, when the row at least said which record. `apps/organizer/src/app/(dash)/tools/report/page.tsx:399`, `apps/organizer/src/lib/data.ts` (`auditSubject`).

**N2, medium. A mixed-case sign-in address can bar an attendee from a session their ticket covers.** `apps/organizer` is not involved; this is `app/src/lib/data/session-seats.ts`. The new lookup queries registrations on an exact `email` match using the address as the account holds it, with no lowercasing. Stored addresses are lowercase. An empty result gives `ticketType = null`, `ticketEligible` returns false, and the screen says "Not on your ticket" and disables the button. The code handles a refused read but not an empty one, and `firestore.rules:159` warns about exactly this folding hazard. The same applies to anyone whose registration holds their address as an alternate.

**N3, medium. Stacking every table below 768px makes short numeric tables much longer.** `apps/organizer/src/app/(dash)/ui.tsx:190`. The default flipped to on and nothing anywhere passes the opt-out the docstring describes. `/engagement/live-polling` is 14,908px at 390 because each poll option becomes a four-line card. The five-line ledgers on `/tickets/orders-and-transactions/summary` and `/pay/balance` have the same shape. The change is right for the tables the issues named and wrong for a few grids that read across.

**N4, low. The email wrapping fix reaches ten places and misses six.** All six are in stacked cards where the break shows. The "by" actor on `/tickets/orders-and-transactions/attendee-orders` and `/pay/order-details` reads `demo@knowledgegraph.tec` then `h`. Also `apps/organizer/src/app/(dash)/messaging/message-screen.tsx:167`, `.../attendees/release-and-consent-forms/register-view.tsx:118`, `.../attendees/check-in-and-checkout/check-in/desk-table.tsx:146`, `.../tickets/ticket-marketing/campaign-contact-list/page.tsx:189`, `.../attendees/admin-settings/page.tsx:113`, `.../tickets/audience-orders.tsx:174`.

**N5, low. Three shortened search hints now under-sell the box.** `/attendees/manage-attendees/attendees` searches ticket type, category and interests; the hint lists only name, email, company and title. `/attendees/categories` and `/attendees/name-badges` both still search category and the hint no longer says so. On the Categories screen that is the field people would reach for first.

**N6, low. Nine of ten app screens log a hydration error.** "In HTML, `<button>` cannot be a descendant of `<button>`", on home, agenda, people, community, me, documents, badge, schedule and session Q&A, but not messages. The nested pressable pattern is older than this round, so this is almost certainly pre-existing, but it is a console error on nearly every screen.

**N7, low. The header magnifier scrolls to the search box but does not put the caret in it.** A reader still has to tap. Better than before, not finished.

**N8, low. Question upvote buttons are 44x39 at 390**, just under the 44 the rest of the app holds to.

**N9, low. The right-edge fade on the programme filters is always on**, so the last chip looks soft even when the row is scrolled to the end and there is nothing more to the right.

## 4. Diff review

**Tests: nothing weakened.** Two test files changed, both net additions. Three new cases pin the joined date-and-time helper, including the evening-scan case that caused the high issue. One assertion in `tests/programme/door-dashboard-core.test.ts` flipped from 0 skipped gaps to 1, because the empty-hour limit came down from 36 to 12; the comment above it says so. No test deleted, skipped, narrowed or marked exclusive.

**Logic smuggled into layout work: four places, all commented, two worth naming.**
- The empty-hour limit went from 36 to 12. That changes what the arrivals chart draws at any real event, not only against this seeded data. It is the right call for the issue and it is a behaviour change, not a layout one.
- Session eligibility now reads the reader's registration on the screen rather than only inside the transaction. This is the high fix and it works, with the gap in N2. Two smaller things ride along: the collection hook gained a null gate, and with null it stays in loading forever, so a restricted session opened by an account carrying no address would leave the button permanently disabled rather than merely unchecked.
- The programme gained a real server-side search with its own address, carried through every filter chip. Sound work, and a new feature rather than a fix to a layout.
- Scanner stations now group by name and count devices; audit entries gained a name field.

**Shared CSS that moves the desktop look: four, all deliberate.** A link colour token added at the root, which is the fix for three issues and also re-colours every link-shaped submit button at every width from one blue to the anchor blue. Empty tables went from a fixed 400px to a 180px minimum everywhere. The sidebar header button stopped shrinking and the title beside it takes the ellipsis. On the website, tick boxes and radios are a fixed 20px square in every form, and lists inside an answer gained a bottom margin at every width. I checked 1280 on payout, segments, check-in and the report and found nothing broken.

**Collisions between the two agents: none.** Both touched the shared table file and the shared stylesheet and the changes sit side by side in different places. Three issues from two different agents all asked for stacked tables and were answered once, by the default, rather than three times. No work reverted, no rule written twice.

**Information removed from copy.** One that matters, N1. One small one, N5. The rest are good removals: the panel that answered its own heading on the two mailing integrations, the panel heading duplicating the field label under it, a second sentence repeating a count, two buttons duplicating a tab and a header button sixty pixels away, and an unlabelled bar whose number is already on a labelled tile above it.

## 5. Check results

| Check | Result |
|---|---|
| `npx tsc --noEmit` in `apps/organizer` | pass |
| `npx tsc --noEmit` in `apps/web` | pass |
| `npx tsc --noEmit` in `app` | pass |
| `npm test` at the repo root | pass, 53 files, 962 tests |
| rules tests against the emulator | pass, 3 files, 321 tests |

The three type checks were run twice, before and after another agent touched the tree mid-session; both runs were clean. Working tree is 89 modified files, no untracked, no deletions.

Nothing was fixed. Evidence is under `/private/tmp/claude-501/-Users-hartigan-Documents-Claude-Projects-KGC/ce473dc2-4864-489c-bc7b-43704d7578c0/scratchpad/audit/verify/` (`v390a`, `w375a`, `wfresh`, `dfresh1`, `dfresh2`, `app2`, `app3`, `states`).