# App fixes
**Local links**

- Attendee app — http://localhost:8081 (`rune.petrova@example.test` / `kgc2027demo`, event code `KGC2027`)
- Organizer dashboard — http://localhost:3100 (`demo@knowledgegraph.tech` + the passphrase in `apps/organizer/.env.local`)
- Public website — http://localhost:3200

---

## What I did

Wrote `/private/tmp/claude-501/-Users-hartigan-Documents-Claude-Projects-KGC/ce473dc2-4864-489c-bc7b-43704d7578c0/scratchpad/audit/walk2.mjs`, which signs in and walks every screen at 390x844 with a touch context. The app scrolls inside a react-native-web `ScrollView`, not the document, so `fullPage` captures only the first 844px — the script scrolls that container and shoots each viewport. Before/after sets are in `b1-before/` and `after/`; the flow drivers are `flows.mjs`, `r2check.mjs`, `sp.mjs`, `ro.mjs`, `overlap.mjs`.

## Fixed, grouped by cause

**1. `hitSlop` written without `webSlop` (14 controls, one cause).** react-native-web drops `hitSlop`, so a control drawn at 22pt with slop to 44 is a 22px target in a phone browser. `webSlop` already existed and was used in 5 of the 12 files that call `hitSlop`. I paired every remaining one and wrote the rule into `a11y.ts`'s docblock so the next author sees it. Where the control has a fill (profile pill, segmented control) I moved the fill to an inner view, the split `FilterChip` already made, so padding could not grow the pill. Files: `components/a11y.ts`, `section-card.tsx`, `whova-header.tsx`, `session-qa.tsx`, `(tabs)/home/index.tsx`, `(tabs)/community/index.tsx`, `(tabs)/community/[id].tsx`, `messages/index.tsx`, `messages/[threadId].tsx`, `+not-found.tsx`. Measured: 53 distinct under-44 targets before, 28 after, and the 28 are the five exceptions listed below.

**2. A horizontal `ScrollView` defaults to `flex: 1`.** In the New topic sheet the category chips took all the vertical space the sheet had: Title and body were pushed 520pt down and the body box ran off the bottom edge. `flexGrow: 0, flexShrink: 0`. (`community/index.tsx`)

**3. The access projection was subscribed once, while signed out.** `AppAccessProvider` is mounted above the sign-in screen and `settings/appAccess` needs a signed-in reader, so with `[]` for deps the listener was refused and never rebuilt. It recovered only on a full reload. On the session where an attendee actually signs in — which is every attendee's first session — the join code was never asked for, the messaging switch read as on however it was set, and the access window never closed. Keyed both it and `useJoinCode` on the uid. This is the single biggest find; three round-two features were inert because of it. (`lib/data/app-access.tsx`)

**4. Four segment labels in an 88pt box.** The People control rendered "Attendee / s" and "Exhibitor / s". One size down and a smaller gutter when there are more than three segments. (`whova-header.tsx`)

**5. The A–Z rail's letters did not touch.** Its docblock claimed each letter gets 40–50pt; `justifyContent: 'space-evenly'` gave each 13pt of target with 8pt of dead gap between. `flex: 1`, so they tile. 13 → 24pt. (`people/index.tsx`)

**6. A heading with nothing under it.** A topic with no replies showed "0 REPLIES" over 500pt of empty grey. Now "No replies yet. Be the first." (`community/[id].tsx`)

**7. The search field was 36 of its 44pt row.** The top and bottom 4pt of a field that looks tappable did nothing. `alignSelf: 'stretch'`. (`whova-header.tsx`)

**8. A poll had no name.** Every other block on a session is headed — About, Materials, Questions, Speaker — and the poll arrived as a bare sentence between two of them, with no cue that a tap votes. Added a POLL label. (`session-poll.tsx`)

**9. Data: 15 of 16 seeded replies carried no `status`.** Round three finding A, still real. The seed writes `status: 'visible'` now but this database predates that, and the query is filtered on it because the rules require it — so the board said "No replies yet" under posts with five. Patched the 15 through the emulator REST API. `lib/data/community.ts` claims "That set is empty in this database"; it now is.

## Round-two work, checked against the running app

| | |
|---|---|
| Session capacity / waitlist | Works. Capped session shows "Join Waitlist" and "Full."; uncapped shows "0 of 42 seats taken". |
| App access window | Works, after fix 3. Set `readOnlyFromMs` to a past instant: the reply box became "The event is over. The board is still here to read." and Add Topic disappeared. Restored. |
| Join code prompt | Broken before fix 3, works after. Cleared `joinedAt`, signed in: the gate appears, refuses `NOPE`, and accepts `kgc-2027` (hyphen and lower case both normalised). |
| Messaging off switch | Works, after fix 3. Set `messagingEnabled: false`: every "Say Hi" gone, header Messages icon gone, Me drops the toggle and says "The organizers have turned messaging off for this event." Restored. |
| Session moved notice | Reaches the app as an announcement ("Room change: SHACL in Production"), on Home and on Announcements. There is no notice on the session itself; ROUND-TWO.md lists that as needing Functions, which are not deployed. |
| Custom pages under Home | Works. Home › Documents lists Wi-Fi, Getting here, FAQ under EVENT INFORMATION, and `/home/page/faq` renders. |
| Hidden replies | Works. Set one reply to `hidden`: the count went 5 → 4 and that reply alone vanished. Restored. |

## Left, and why

- **ui-issues app items already fixed before I arrived**, verified by looking rather than by grep: the tab bar no longer covers the last row (the panel reserves 55px and the scroller's bottom lands exactly on the bar), `WEB_TAB_BAR` is 0 so there is no empty band above a title, the badge caption is one line plus the already-checked-in line, `+not-found` says "Page not found", the tab title is "KGC 2027", the login landing says how to sign in once, `data-error.tsx` names no internals, and both the survey and Q&A screens get keyboard insets through `Screen avoidKeyboard`.
- **Five targets still under 44, all deliberate.** The web tab bar's 78x40 buttons and 10px labels are our CSS rebuild of the bar iOS and Android draw natively at those sizes. The header Messages icon is 34x44 — its horizontal slop is halved on purpose so two header actions cannot overlap, and widening it at the right edge is what gave `/messages` a sideways scroll mid-way through this work. The A–Z rail is 44x24: 26 letters at 44 would be 1,144pt on an 844pt screen. The `/me` switches are the platform `Switch`. A 54x20 link inside a Markdown paragraph cannot be 44 tall without wrecking the line height.
- **Community replies show no author and no time.** The board does not name authors either, so it is consistent; making it otherwise needs directory lookups per reply and a privacy decision, not a layout fix.
- **`"Room 271 has moved to Classroom 4 (19:17:05)"`** — a test timestamp left in a live announcement, visible on Home. Organizer data, not app code, and another agent may be using it as a marker.
- **`ui-issues.md` untouched** — several agents are editing it, and I was asked for a report rather than a doc.

## Proof

`npx tsc --noEmit` in `app/` clean. `npx vitest run app/src` 53/53. `npm test` at the root 52 files, 944/944. I did not touch `firestore.rules`, so the rules suite did not apply. Final walk: no sideways scroll and no element past the right edge on any of the 57 screens at 390, none at 1280 across seven routes, no em dashes in prose anywhere in the app.

## Files changed

All under `/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/app/src/`: `components/a11y.ts`, `components/section-card.tsx`, `components/whova-header.tsx`, `components/session-qa.tsx`, `components/session-poll.tsx`, `app/(tabs)/home/index.tsx`, `app/(tabs)/people/index.tsx`, `app/(tabs)/community/index.tsx`, `app/(tabs)/community/[id].tsx`, `app/messages/index.tsx`, `app/messages/[threadId].tsx`, `app/+not-found.tsx`, `lib/data/app-access.tsx`. Nothing outside `app/` was edited; the other modified files in the tree belong to agents working alongside me.

# Website and copy
**Local links:** dashboard `http://localhost:3100` · website `http://localhost:3200` · attendee app `http://localhost:8081` (all three answered; emulators on 8080/9099 up).

## What I fixed, grouped by cause

**Copy that named internal machinery**
- `/tickets/checkout|exhibitor|sponsor` — the rehearsal block's hint printed `scripts/ops/reset-demo-sales.mjs`. Now "marked `demo` so it can be undone". `apps/web/src/app/tickets/checkout-form.tsx`
- Projects and Checklists showed an organizer a task note reading "SETUP-PAYMENTS.md section 4". Changed in the seed and in the live emulator record (`tasks/seed-task-10`). Proof: re-dumped that screen's text, it now reads "Ask the developer for the payment setup steps." `scripts/src/lib/fixtures.ts:930`

**A dead end with no next step**
- The checkout form said "Ticket sales are not open yet." over a form nobody can submit. Now offers "Email us and we will hold a place for you." This is the same defect round one raised on `/tickets/invoice`; the invoice page was already fixed, the checkout was not. Spelling the address out ran 291px inside a 245px paragraph on the 299px exhibitor/sponsor column and pushed the document 14px wider than the window — caught it at 1280 and changed the link text to "Email us". Verified `hscroll:false` at 375, 390, 768 and 1280 on all three pages.

**One fact said twice**
- `/tickets/exhibitor` and `/tickets/sponsor` printed "3–7 May 2027 | Cornell Tech" on the `when` line and again as the first sentence of the lede. Round one asked for the line back; it came back without the sentence going. Dropped it from both ledes. Screenshotted at 390 and 1280.

**Internal pages reachable by strangers**
- `/tickets/options` and its ten `v1`–`v10` routes are a design review ("the only thing that differs is the part being judged"). The index carried `robots: noindex`, which asks a crawler not to list it and stops nobody; the ten sub-routes had nothing. New `apps/web/src/app/tickets/options/layout.tsx` calls `notFound()` when `NODE_ENV === 'production'`, so the whole subtree 404s on Netlify and still works under `next dev`. Same compile-time constant `lib/demo-checkout.ts` relies on. **Not provable here** — proving it needs a production build, which I was told not to run.
- `/tickets1` sells the same four tickets as `/tickets`; left indexable it competes with the real page. Added `robots: noindex`. Verified: `<meta name="robots" content="noindex, nofollow">`.

**Seed typo** — the announcement titled "Wifi" on the public site and in the app, next to a `wifi` page and a `/documents` row that both spell it "Wi-Fi". Fixed in the fixture and the emulator.

## The three you asked me to confirm rather than assume

- **Footer KGC mark** — fixed. `.site-footer .mark` carries `filter: brightness(0) invert(1)`; cropped the footer at 375 and the wordmark is white on navy.
- **Duplicated day chips on /agenda at 768** — fixed. Cropped `/agenda` at 768: one labelled DAY row, one TRACK row. At 375 the DAY label is hidden and the row is `position: sticky`.
- **Lazy images blank in a full page capture** — **a capture artifact, not a site defect.** In `clip.mjs`/`shot.mjs` output the sponsor tiles and five of the `/team` portraits are white boxes, because Playwright screenshots immediately after resizing to full height. Drove a real scroll-through of `/`, `/speakers`, `/team`, `/learn`, `/exhibitors`, `/sponsor`, `/blog`, `/about`, `/hcls`, `/community`: **0 of 25 images on the home page fail to load**, and every optimizer URL returns 200. The audit tool needs a settle delay; the site does not need a change.

## Issues I checked and found already fixed (no edit)

Cookie notice (93px bar at the bottom edge at 375, not a third of the screen) · `/learn` hero tagline on a panel at 375, on pale ground at 768 · sponsor wall 2,091px not 4,500, two per row · `/tickets` all four tiers as equal cards, no stray "·" · `/documents` host line back and all 3 publicly-visible published documents listed (the 4th is ticket-restricted, correctly hidden) · `/startup-pitch` and `/call-for-posters` dates paragraph now "Dates to be announced." · `/tickets/invoice` form removed from behind the notice · `/agenda` track on its own line, no dangling dot, sticky day chips · home day tabs fit in 286px · LinkedIn icons are 20px glyphs inside a 40px `::after` hit area · `/blog` chips 36px with 8px gap · helper-copy lines on `/documents`, `/previous-events`, `/blog` gone · sponsor ai-voice copy rewritten · "(Phil) (Meredith)" gone from the roster (45 speakers, none with parens) · no em dash in any seeded collection.

## The copy pass

- **apps/web** — dumped rendered `innerText` for all 30 routes. One em dash (verbatim testimonial from a named person, Tommaso Soru — altering an attributed quote is worse than the dash), one "robust" (transcribed founder bio on the replica `/about`), one script path (fixed). Nothing else.
- **app** — clean. No filler. Em dashes are three `—` empty-value markers. The issues listing developer strings (`Is the emulator running?`, `Firebase's minimum, not ours`, `isn't part of the app`, the badge caption, the duplicated sign-in lines) are **all already fixed**; `data-error.tsx` now gives one-line messages per failure kind.
- **apps/organizer** — `SHOW_GAP_NOTES` is unset, so the 126 gap panels carrying the Whova comparisons and collection names **do not render**. Dumped rendered text for all 215 routes (the dev server dropped mid-run; re-ran the 47 that failed). Result: zero filler, and every em dash is the empty-cell marker. Three name hits, all left deliberately: "Whova Listing" is a nav label and the rules say keep the nav tree; "Zapier" is a real product on an integrations page; "SETUP-PAYMENTS.md" was the one I fixed.

## Left, with reasons

- **The "Powered by Netlify" badge** (7 issues). Injected by Netlify's edge on the free tier. Nothing in this repo can turn it off; it is a site setting on the three `kgc27-*` sites.
- **Two `/documents` rows point at `https://example.invalid/`** (venue map PDF, travel notes PDF). The code half is fixed; what remains needs a real file. I did not invent a URL, and pointing a card labelled PDF at an HTML page is the capability claim AGENTS.md warns about.
- **The latest announcement is titled "Room 271 has moved to Classroom 4 (19:17:05)"** — a wall-clock timestamp in a headline, on the public page and in the home ticker. It is a live-write artifact (random Firestore id `sw9qBO0ZDcIOVmndYPwJ`, not a seed id) from another agent's verification. Left it rather than edit data a concurrent run may be asserting against.
- **The `/previous-events` footer is 1,136px at 375**, 60% of that page. Both proposed fixes landed (two columns, 140px wordmark). The rest is fourteen links at a 44px touch target, a deliberate earlier accessibility fix; shrinking it would undo that.
- **`/tickets1` kept**, not deleted — it is a working ticket page with no internal prose, just unlinked.
- **Dashboard-prefixed issues** left to whoever owns them; that tree had eight files modified by another agent while I worked.

## Verified

`npx tsc --noEmit` in `apps/web` — clean. `npm run typecheck --workspace=@kgc/scripts` — clean. `npm test` at the root — **52 files, 944 tests, all passing**. `firestore.rules` untouched, so no rules run. No commits, no server or emulator restarts, no builds.

## Files changed

- `/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/apps/web/src/app/tickets/checkout-form.tsx`
- `/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/apps/web/src/app/tickets/exhibitor/page.tsx`
- `/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/apps/web/src/app/tickets/sponsor/page.tsx`
- `/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/apps/web/src/app/tickets1/page.tsx`
- `/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/apps/web/src/app/tickets/options/layout.tsx` (new)
- `/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/scripts/src/lib/fixtures.ts`
- Emulator data: `announcements/seed-ann-2.title`, `tasks/seed-task-10.notes`

# Three features proved
Done. Report below.

## The three local sites

| | URL | sign-in |
|---|---|---|
| Organizer dashboard | **http://localhost:3100** | `demo@knowledgegraph.tech` + the console passphrase |
| Public website | **http://localhost:3200** | none |
| Attendee app | **http://localhost:8081** | `rune.petrova@example.test` / `kgc2027demo` |

---

## 1. Ticket transfer — works, and the refund gap was real and is now closed

**Driven:** recorded a paid offline order for "Transfer Alpha" (Standard Booth, $1,200) on `/tickets/exhibitor-ticket-setup/2-6-offline-payment`, gave Alpha an Auth account carrying `registered: true` (what signing in leaves behind), gave "Transfer Beta" an account with `registered: false`, then transferred on `/attendees/manage-attendees/attendees?edit=…#transfer`.

Observed, each checked in Firestore or on screen:

- Banner: "Transferred to Transfer Beta… Transfer Alpha no longer has a ticket."
- Beta `reg_0a3153fd…` is `active` with her **own** `qrSecret` (`FOj3Q-7Z…`) and claim code `98DWGM`; Alpha's are untouched and now belong to a dead document.
- Alpha `reg_edc670e0…` is `transferred`, `transferredTo` → Beta.
- **Check-in desk:** Alpha's QR secret *and* her claim code both return `CANCELLED / "This registration is transferred, not active. Not checked in."` — no `checkIns` document written. Beta's QR and claim code both check her in; the only `checkIns` doc for this pair is Beta's.
- **App access:** Alpha's claim flipped to `registered: false` and her refresh tokens were revoked; Beta's flipped to `true`. Signing into the app as Alpha still *succeeds* (the password screen does not consult the ticket) but every read is denied and Home shows "Your pass has not reached this device… permission-denied".
- **Order:** `registrationIds` went from `[Alpha]` to `[Alpha, Beta]`.
- **Audit:** `attendee.transfer`, actor `demo@knowledgegraph.tech`, before/after naming both addresses.

**The known gap was still true.** `cancelRegistrationByOrder` computed the registration to cancel as `registrationId(order.email)` — the buyer. After a transfer that id is the dead document, so a refund would take the money back and leave the new holder's badge scanning. `cancelExtraSeats` had the same bug per seat, and both would have `update()`d a missing document and 500'd the webhook if the registration had been deleted.

**Fixed, not guarded.** The fix does not touch the payment call at all; it only corrects which registration the existing withdrawal aims at.

- New shared helper `currentHolder(store, id)` in `/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/scripts/src/lib/fulfilment.ts` — follows `transferredTo` to the end of the chain, with a cycle guard, returning `null` when there is nothing to cancel.
- `/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/apps/web/src/lib/registrations.ts` cancels the holder, asks the "still paid elsewhere" question about the holder's address, and reports `holderEmail` on the outcome.
- `/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/apps/web/src/app/api/stripe/webhook/route.ts` withdraws entitlements from the holder, and `cancelExtraSeats` follows each seat's chain too. The refund receipt still goes to the buyer, which is right — they paid.

**How it was proved.** The webhook itself cannot be driven here: there is no `STRIPE_SECRET_KEY` and no webhook secret, so no signed `charge.refunded` can be delivered and `sessionIdForPaymentIntent` calls Stripe. Saying that plainly rather than claiming an end-to-end run. What *was* run against the live emulator is the helper the fixed path now depends on, on real chains:

```
transfer-alpha  buyer id reg_edc670e0…  → holder reg_0a3153fd… (transfer-beta, active)
aec-a-mua2nbsr  buyer id reg_6a960352…  → holder reg_e2927ecd… (two hops, active)
rune.petrova    buyer id reg_01e16214…  → holder reg_01e16214… (unchanged)
nobody@…        buyer id reg_92b1f039…  → none (skip, not a throwing update)
```

---

## 2. Cancel and reinstate — works, in both directions

**With a paid order behind it.** Recorded an offline order for Rune Petrova (Startup Table), then cancelled her from the edit panel.

- Message: "Cancelled Rune Petrova. Their badge will not scan. One Startup Table seat is back on sale. No money was refunded."
- Badge at the desk: `CANCELLED / "This registration is cancelled, not active."`
- Seat: `Startup Table` `quantitySold` 1 → 0, and `releasedSeats.reg_01e1…` written on the order so a later refund cannot hand the same seat back twice.
- App access: claim → `registered: false`, refresh tokens revoked.
- **In the app:** she can still sign in with her password — nothing on the sign-in screen checks the ticket — but Home shows "Your pass has not reached this device… permission-denied" and Me › Badge shows the unavailable card. So it is the data that refuses her, not the door. That is worth knowing before a rehearsal: a cancelled attendee sees a broken-looking app, not a "your ticket was cancelled" screen.
- **Reinstate reversed all four:** status `active`, `seatRelease` deleted, `quantitySold` 0 → 1, `releasedSeats` emptied, claim back to `registered: true`, badge scans, badge screen renders again.

**With no order behind it.** Added "No Order Person" by hand and cancelled. The panel dropped the "seat goes back on sale" sentence, the message was just "Cancelled… Their badge will not scan", no `seatRelease` was written and `All Access (VIP)` stayed at 0. Correct.

**One thing I fixed while driving this.** The app told a cancelled attendee "**Your ticket is fine**; this device could not reach it." It is not fine — a cancelled ticket is exactly what lands on that screen. Now: "This device could not read your ticket. At the door, the registration desk can find you by name or by the claim code on your order confirmation page." (`app/src/app/(tabs)/me/badge.tsx`, checked at 390.)

---

## 3. Conditional registration questions — works, browser and server

**Editor.** Added "Which university are you at?" on `/tickets/ticket-setup/1-2-question-forms` with *Show only when* → "What best describes your role?" *is answered* "Student". The list immediately read back "Shown when 'What best describes your role?' is 'Student'".

**Checkout form** at `http://localhost:3200/tickets/checkout?tier=main-conference`:

| answers | university question | vegetarian question |
|---|---|---|
| nothing | absent | absent |
| role = Student | **present** | absent |
| + diet = Vegetarian | present | **present** |
| role → Engineer | **gone** | present |
| diet → No requirements | gone | **gone** |

**Server.** Filled the form as Engineer / No requirements, then appended hidden inputs for both untriggered questions and submitted — which is what any client can do. The registration was created and stored exactly:

```
{ code-of-conduct: true, dietary-requirements: "No requirements", job-function: "Engineer" }
```

"Probe University" and "Halloumi" are not on the document and not in `pendingAnswers`. So the browser is not the only thing enforcing it. One precision: the server **drops** the answer, it does not return an error — that is deliberate and documented in `validateAnswers` (a buyer who answers and then changes their mind has done nothing wrong). If you want a refusal instead of a silent drop, that is a decision, not a bug fix.

(The test question was removed again through the editor; the pre-existing vegetarian one is untouched.)

---

## What I left, and why

- **No regression test for `currentHolder`.** The only suite that can reach it is `tests/commerce`, which I was told not to run because it wipes the seeded database. Adding a test I cannot run is worse than not adding one; it belongs in the next commerce run.
- **The refund webhook is unprovable locally** for the reason above.
- **Test data stays in the emulator**: Transfer Alpha/Beta and their Standard Booth order, "No Order Person" (left cancelled), and a demo-checkout order for `cond-probe-1@example.test`. Beta has a check-in row, so deleting her would leave a dangling entry on the desk screen. Rune's state was restored exactly — her order deleted, `Startup Table` back to 0 sold, status active, claim code unchanged.

## Files changed

- `/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/scripts/src/lib/fulfilment.ts` — new `currentHolder`
- `/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/apps/web/src/lib/registrations.ts`
- `/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/apps/web/src/app/api/stripe/webhook/route.ts`
- `/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/apps/organizer/src/app/(dash)/attendees/check-in-and-checkout/check-in/scanner.tsx` — the consent line said "They are checked in" under a verdict saying they were not
- `/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/app/src/app/(tabs)/me/badge.tsx`

**Checks:** `npx tsc --noEmit` clean in `apps/web`, `apps/organizer`, `app` and `@kgc/scripts`; `npm test` at the root — 52 files, **944 tests passing**. `firestore.rules` untouched, so the rules suite was not needed. Both changed screens checked at 390 and 1280 with no sideways scroll.

# Issue verification
## Local host links (the three sites)

| | URL | sign-in |
|---|---|---|
| Organizer dashboard | **http://localhost:3100** | `demo@knowledgegraph.tech` + the `CONSOLE_PASSPHRASE` in `apps/organizer/.env.local` |
| Marketing website | **http://localhost:3200** | none |
| Attendee app | **http://localhost:8081** | `rune.petrova@example.test` / `kgc2027demo` |

All three answer now (3100 → 307 to /login, 3200 → 200, 8081 → 200) and point at the seeded emulator on 8080/9099.

## What I did

Verification only — **I changed no files and fixed nothing** (this run was assigned as the independent check; other agents in this workflow hold the fixes, and editing while verifying would have corrupted the result). No git commands beyond `log`/`status`/`diff --stat`. No typecheck/test run was needed since I touched nothing.

I sampled **52 issues** from `ui-issues.md` across all three severities, screenshotted each at the width the issue names, then walked **30 dashboard screens at 390** and **10 website pages at 375** that the list does not mention, plus a full attendee-app walk at 390.

Screenshot base: `/private/tmp/claude-501/-Users-hartigan-Documents-Claude-Projects-KGC/ce473dc2-4864-489c-bc7b-43704d7578c0/scratchpad/audit/`

---

## Sampled issues, with verdicts

### High — 3 of 3 fixed

| Issue | Verdict | Evidence |
|---|---|---|
| reviewers inline criterion Edit runs off 390 | **fixed** — open editor measures left 44 → right 346, `documentElement.scrollWidth` 390, zero overflowing children | `v4rev/reviewers-edit-390.png` |
| app tab bar covers the reply bar and last row on every tab screen | **fixed** — Reply box and Send sit clear above the tabs; every tab root scrolled to its end shows its last line | `v4app2/topic-bottom.png`, `v4app2/end_me_badge.png`, `v4app2/end_home.png` |
| community replies invisible on the phone, board says "No replies yet" | **fixed** — the seeded topic shows "4 REPLIES" and all four; list counts (4/2/2) agree with the dashboard's 16 across 6 posts | `v4app2/topic-bottom.png`, `v4app2/topic.txt` |

### Medium

| Issue | Verdict | Evidence |
|---|---|---|
| empty state narrower than the table (message-*, create-group-tickets, agenda analytics, 2.2/2.6/1.6) | **fixed** — the shared empty box now spans the full table under the header, no side strips | `v4/tickets_ticket_setup_create_group_tickets-390.png`, `v4/marketing_event_webpages_agenda_webpage_analytics-390.png` |
| Logistics Center / Speaker Manager still sideways-scroll at 390 | **fixed** — stacked rows, Screen/Edit reachable | `vpd/content_logistics_center_900-390.png` |
| reviewers `<summary>` row actions under 32px | **fixed** — every summary 32px tall, 89–162 wide | revcheck measurement |
| 2.5 Ticket Add-ons 400px empty box at 1280 | **fixed** — short paragraph under a heading | `v4b/tickets_exhibitor_ticket_setup_2_5_ticket_add_ons-1280.png` |
| discount-codes empty state gives no reason | **fixed** — "Discount codes need Stripe / Connect Stripe to create and track codes." | `v4b/tickets_ticket_setup_discount_codes-1280.png` |
| engineering notes on 7 ticket screens ("apps/web, port 3200", "refundedAt", "npm run reconcile:sold") | **fixed** — grep over rendered text of all 7: zero hits | `v4/text-a.txt` |
| essays on ticket-add-ons / session-rsvp / member-and-invite-only / connection guides | **fixed** — each is now a two-line statement plus a real data table | `v4/text-a.txt` |
| 2.6 Offline Payment unstyled 20px controls | **fixed** — `whova-checkbox-input` 16×16, standard inputs | `v4/tickets_exhibitor_ticket_setup_2_6_offline_payment-390.png` |
| 1.1 Create Tickets price half-cut at 390 | **fixed** — stacked cards, "$1,199.00" whole, Edit/Hide on screen, no slug line | `vpd/tickets_ticket_setup_1_1_create_tickets_700-390.png` |
| transaction-history prints raw provider JSON | **fixed** — "Sending domain not verified" + Details | `v4/text-a.txt` |
| email-campaign 150px subject, 180px message, "Type3to confirm" | **fixed** — full-width standard input and textarea, "Type **3** to confirm" | `v4b/tickets_ticket_marketing_email_campaign-1280.png` |
| Export to AMS/CRM talks about Zapier | **fixed** — rewritten generically, title matches the menu | `v4/text-a.txt` |
| **/tickets/payout 390: explanation cut mid-line, last column unnamed** | **still open (partly)** — column is now named "Why", but the sentences still sit in a sideways-scrolling table and read "Taken out of the payout, n…", "Roughly 2.9% + 30¢ per c…" | `vpd/tickets_payout_1000-390.png` |
| hybrid-settings / attendee-limit essays | **fixed** — one line: "This event is in-person only. Hybrid settings are not available yet." | `v4/text-a.txt` |
| check-in filter chips 20px, sort links 16px | **fixed** — no sub-32 chip or sort link in the metrics for check-in, categories, segments, session-cap, name-badges | `v4/metrics-390.json` |
| release-and-consent-forms sideways table at 390 | **fixed** — stacked rows | `v4/attendees_release_and_consent_forms-390.png` |
| logistics-webpage venue address at stat-number size | **fixed** — body size, tile row normal height | `v4b/marketing_event_webpages_logistics_webpage-1280.png` |
| my-event-listing / event-website name code paths | **fixed** — "Ask the developer", "live Create Tickets"; footnotes gone | `v4/text-b.txt` |
| round-table / scheduler / speed-networking unstyled form fields | **fixed** — styled inputs and selects throughout | `v4b/engagement_round_table-1280.png` |
| announcements raw ISO timestamp | **fixed** — "Sep 20, 7:17 PM" | `v4/text-a.txt` |
| session-feedback info tip claims the app has no survey screen | **fixed** — sentence deleted from both pages | `v4/text-a.txt` |
| 1-1-meeting-scheduler / round-table When column off screen at 390 | **fixed** — stacked rows, When and actions on screen | `vpd/engagement_1_1_meeting_scheduler_900-390.png` |
| surveys: two filled blue buttons, no gap | **fixed** — "Create the first one" is now a secondary outline button with spacing | `v4b/engagement_surveys-1280.png` |
| streaming-setup: 7 dead ends with unrelated buttons | **fixed** — one line, one related link | `v4/text-b.txt` |
| rehearsal-sessions "until 09:00Lessons from a s" at 390 | **fixed** — time and title in separate cells (title column still clips inside the sideways scroller, see new findings) | `vpd/…rehearsal_sessions_1200-390.png` |
| **/pay/publish is named "Publish", same as the top-level tab** | **still open** — nav title and `<h1>` are both still "Publish" | `v4/text-b.txt` |
| /tools/report developer text and UTC ISO times | **fixed** — notes gone, "Today is Mon, Sep 21, 2026, New York time", "Last scan 21 Sept 2026, 22:52" | `v4/text-b.txt` |
| /pay/publish tax essay quoting `txcd_20030000`, `automatic_tax` | **fixed** — four-row Done / Open in Stripe checklist | `v4/text-b.txt` |
| session-chats explains `participantIds` | **fixed** — "Session chat is not available yet" | `v4/text-b.txt` |
| web cookie notice covers the lower third, hides "See the agenda" | **fixed** — slim bottom bar with the button inline; hero CTAs and the first ticket card clear | `vp/home_0-390.png`, `v4w/tickets-390.png` |
| /learn hero tagline unreadable on the wave mesh | **fixed** — solid light panel behind the text | `vp/learn_0-390.png` |
| sponsor wall ~4,500px at 390 | **fixed** — `.sponsor-tiers` measures 342 × **2,136** | measurement |
| /tickets Workshops and Virtual as bare rows with stray "·" | **fixed** — four equal cards, each with Choose; no dangling dots | `v4w/tickets-390.png` |
| /documents shows 1 of 4, host line removed | **fixed** — 6 documents listed, host line back ("www.knowledgegraph.tech") | `vp/documents_0-390.png` |
| startup-pitch / call-for-posters "2027 calendar is not confirmed" | **fixed** — "Dates to be announced. Questions: startup-pitch@knowledgegraph.tech." | `v4w/text-web.txt` |
| exhibitor/sponsor hero buttons touching, no date or venue | **fixed** — clear gap, "3–7 May 2027 | Cornell Tech, Roosevelt Island" restored | `vp/tickets_sponsor_0-390.png` |
| /tickets/invoice shows the whole form under "not open" notice | **fixed** — form removed; notice says email us; placeholders moot | `vp/tickets_invoice_0-375.png`, `vp/tickets_invoice_600-375.png` |
| demo skip-payment block names a script, unproven guard | **fixed** — script name gone; `demoCheckoutAllowed()` is `NODE_ENV !== 'production'` **and** a localhost host, re-checked server-side in `completeDemoCheckout` | `apps/web/src/lib/demo-checkout.ts`, `apps/web/src/app/tickets/actions.ts:570` |
| app: 68px empty band above every signed-in header | **fixed** — header sits at the top | `v4app/10-home.png` |
| app /people hitSlop targets | **partly fixed** — A–Z rail letters now 44×24 (width fixed, height still 24), Messages icon 34×44; Follow and filter chips no longer flagged | `v4app/walk.json` |
| app login link tap targets | **fixed** — nothing under 44 on either login screen | `v4app/walk.json` |
| app /me/badge 60–80 word caption | **fixed** — three short lines, and the "already checked in" advice is back | `v4app2/end_me_badge.png` |

### Low (sampled)

| Issue | Verdict | Evidence |
|---|---|---|
| content/basics prints the event id | **fixed** | `v4/text-b.txt` |
| exhibitor-manager note says the app has no exhibitor page | **fixed** | `v4/text-b.txt` |
| checklist status pill is the only way to mark done | **fixed** — real "Mark todo" / "Mark doing" / "done" buttons | probe |
| session-manager drag handle that does nothing | **fixed** — zero drag elements in the DOM | probe |
| content menu expand arrows 23×11 at 390 | **fixed** — nav rows are 40–41px; no sub-32 arrow at phone width | probe2 |
| **1.3 Confirmation Emails: em dash subject, re-run promise, raw provider JSON** | **partly fixed** — subject now "Your KGC 2027 ticket: All Access (VIP)", re-run promise gone; **the full provider message is still printed in all five failed rows**, including a personal address and a backticked `from` | `v4b/tickets_ticket_setup_1_3_confirmation_emails-1280.png` |
| payout "what was soldrather than" | **fixed** | `v4/text-b.txt` |
| sponsor registration-settings double dash | **fixed** — "Always" | `v4/text-b.txt` |
| referral-contest / link-tracking em dashes | **fixed** — "Speaker referral: Ada Lovelace → /tickets" | `v4/text-b.txt` |
| session-cap headers break mid-word, room cell misaligned | **fixed** — headers on one line, rows aligned, day chips + pagination | `v4b/attendees_session_cap-1280.png` |
| session-self-check-in lists all 86 sessions | **fixed** — "Items 1–25 of 72", 1 / 3; height 6,500 → 2,571 at 1280 and 15,000 → 3,357 at 390 | probe, `v4/text-ssci.txt` |
| **10px tags and 11px tile labels** | **still open** — category tags render at 10px, stat-strip labels 10px, the DRAFT chips 8px | `v4/metrics-390.json` (`/attendees/categories`) |
| check-in rewrites the stored list name at render time | **fixed** — the tag now reads "KGC 2027: Main Door (event)", so the stored name was corrected | `v4/metrics-390.json` |
| kiosk Device id column of raw identifiers | **fixed** — the only header left is "Station" | probe |
| categories: solid red Delete as heavy as Save | **fixed** — outline secondary | `vpd/attendees_categories_700-390.png` |
| marketing "i" tip is a tiny target | **mostly fixed** — infotip is 31×31 (one px under the 32 standard) | probe2 |
| attendee-activity "1p 1r" and vague tiles | **fixed** — "1 post, 1 reply"; tiles are Attendees / Active / Inactive | `v4/text-b.txt` |
| rehearsal-sessions raw dates, "The ones with nowhere to rehearse" | **fixed** — "Mon, May 3", day filter chips, heading gone | `v4/text-b.txt` |
| /publish "No order has ever been fulfilled" vs 2 paid test orders | **fixed** — "3 paid orders have been fulfilled, excluding test orders"; report adds "1 test order is excluded from every figure above." | `v4/text-b.txt` |
| community-board seeded em dashes | **fixed** | `v4/text-b.txt` |
| /tools/*, /pay/* sidebar rows 25–28px | **fixed** — 40–41px | probe2 |
| /agenda "(Phil) (Meredith)" filtered rather than fixed | **fixed** — no filter left in `event-schedule.tsx`, and the string appears nowhere on /agenda or /speakers | grep + `v4w/text-web.txt` |
| /agenda metadata wraps, dangling "·", no way to jump between days | **fixed** — room and type on their own line, day chips sticky while scrolled | `vp/agenda_1400-390.png` |
| /previous-events 1,300px footer | **fixed** — two columns; the whole page is now 1,764px at 390 | `vp/previous_events_900-390.png` |
| home day tabs cut off after Wed | **fixed** — all five fit, x 45 → 346 in a 390 viewport | measurement |
| **/team and /learn LinkedIn icons 20px** | **still open** — `a.li-icon` measures 20×20 on both | `v4w/metrics-390.json` |
| /blog chips 28px in five rows | **fixed** — nothing under 32 flagged | `v4w/metrics-390.json` |
| obvious helper copy on /documents, /previous-events, /blog | **fixed** — each replaced with a line that carries information | `v4w/text-web.txt` |
| /tickets/sponsor written-for-effect copy | **fixed** — "tote bags", "Sessions, not just signage" etc. all gone | `v4w/text-web.txt` |
| /announcements em dash | **fixed** — "Moved to Bloomberg 165. Bigger room, we underestimated demand." | `v4/text-a.txt` |
| **/tickets/options and /tickets1 publicly reachable** | **still open** — both return 200 and render the internal design-review page and a second ticket grid | curl + `v4w/text-web.txt` |
| /agenda double day row at 768 | **fixed** — one labelled DAY row, one TRACK row | `vp/agenda_0-768.png` |
| footer KGC mark dark blue on navy | **fixed** — light wireframe mark | `vp/previous_events_1600-375.png` |
| app dev strings ("Is the emulator running?", "Firebase's minimum", "missing a database index", "Access is carried in the token") | **fixed** — none remain in `app/src` | grep |
| app login says how to sign in twice | **fixed** — only the "First time here?" hint remains | `v4app/walk.json` |
| app browser tab has no title | **fixed** — every app screen reports `KGC 2027` | `v4app/walk.json` |
| +not-found "The route you followed isn't part of the app." | **fixed** — "Page not found" with a Go to Home button | `v4app/95-notfound.png` |
| app community / survey KeyboardAvoidingView | **not verifiable here** — a keyboard-inset defect does not reproduce in a desktop browser; needs a device or simulator |
| 5 × "Powered by Netlify badge" issues | **not verifiable, and not fixable in this tree** — no badge markup in the repo or in the served HTML of either site. The black circle in my localhost screenshots is the Next.js dev indicator, not the badge. This is a Netlify site setting on the deployed sites only |
| em dash as an empty-cell marker (check-in, attendee-activity, segments: 10–36 per page) | **was never a problem** — the brief names this as an existing convention to leave alone |

**Tally:** 44 fixed, 4 partly fixed and still worth work, 3 still fully open, 5 not verifiable locally, 1 never a problem.

---

## New, ranked — found on screens the list does not mention

1. **`/messaging` is the only dashboard screen that scrolls sideways at 390.** `documentElement.scrollWidth` 448 against a 390 viewport. Cause: `select#recipientUid` is an unstyled native select, 420px wide and 19px tall, starting at x=27 so its right edge lands at 447 — it ignores the panel. The Message box beside it is also a bare monospace textarea. This is the same "use the standard input/select classes" fix that landed on Round Table, Speed Networking and the survey form; `/messaging` was missed. `fresh2/messaging-390.png`
2. **`/tickets/orders-and-transactions/attendee-orders` status filters were missed by the 32px chip fix.** "All 4 / Paid 4 / Unpaid 0 / Part refunded 0 / Refunded 0 / Cancelled 0" are plain 14–15px text links wrapping over two lines, where the same filter row on Check-in and Session Cap is a proper 32px chip. The table beside them also clips its third column with only a faint edge. `fresh2/tickets_orders_and_transactions_attendee_orders-390.png`
3. **`/engagement/live-polling` row actions are 21 × 32.** Height was fixed, width was not — fifteen 21px-wide "Edit" links. Identical to the open low issue filed against Session Feedback and Categories, so one shared minimum-width rule covers all three. `fresh2/engagement_live_polling-390.png`
4. **`/content/speaker-center/message-speakers` still has one bare 13 × 13 checkbox** ("Send me a test first") where the sibling `message-sponsors` and `2-6-offline-payment` use the 16px `whova-checkbox-input`. Same class of defect as the fixed 1.2 Question Forms box. `v4/content_speaker_center_message_speakers-390.png`
5. **CSV import file pickers are unstyled.** `input#csv-track` and `input#csv-speaker` on Track Manager and Speaker Manager render as 253 × 21 browser defaults; `/attendees/certificates` has a 44 × 14 "Remove" button. Same unstyled-control family. `fresh/*-390.png`
6. **`a.tutorial-video` "Event website" in the page header is 88 × 16 on all 173 dashboard screens** — below the 32px minimum the row actions now hold. One header component, one fix.
7. **`/speakers` at 375 reads as unfinished.** "Our First Speakers", five entries shown as 300px dark discs with initials and no photos, ~2,900px of scroll — while the dashboard reports 45 speakers and `/publish` flags "45 no photo". A visitor's impression is a conference with five anonymous speakers. `freshw/speakers-375.png`
8. **Seed noise is on the public site.** The home ticker and the app's Home and Community screens all show the announcement subject "Room 271 has moved to Classroom 4 (**19:17:05**)", and `/documents` lists two PDFs whose host line reads "example.invalid". Data, not code. `vp/home_0-390.png`, `vp/documents_0-390.png`
9. **`/virtual-and-hybrid/online-session-manager/rehearsal-sessions` still scrolls sideways at 390** with talk titles clipped mid-word ("GraphRAG: What…Improved Retrieva…"). The run-together defect was fixed but the table never got the stacked-row treatment that Create Tickets, Logistics Center and the consent register did. `vpd/…rehearsal_sessions_1200-390.png`
10. **The cookie bar is ~140px tall on a 844px screen and covers whatever is at the bottom** on every page until dismissed — the second exhibitor card on `/exhibitors`, the Main Conference card on `/tickets`. Better than the old lower-third panel, but three lines of text is still two more than the bar needs.
11. At 768 the `/agenda` DAY row runs off the right edge after "Wednesday 5 May" with no edge fade, and the cookie notice becomes a floating card rather than a bar. Minor. `vp/agenda_0-768.png`

Nothing on the website scrolls sideways at 375, and nothing on the 30 fresh dashboard screens does at 390 except `/messaging`.

# Diff review
**Local links**

- Organizer dashboard http://localhost:3100 (307 → login; demo@knowledgegraph.tech + the CONSOLE_PASSPHRASE in `apps/organizer/.env.local`)
- Public website http://localhost:3200 (200)
- Attendee app http://localhost:8081 (200; rune.petrova@example.test / kgc2027demo)

This pass was review-only, as the workflow task specified. Nothing was edited; the four fixing agents still hold the tree.

---

**Findings, most severe first**

**1. HIGH — the "bought twice" guard is defeated by any transfer.** `/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/apps/web/src/lib/registrations.ts:494`

`stillPaidElsewhere` was moved from `order.email` to `holder.email`, but the two-orders rule is about the *buyer's* orders, not the holder's. Failure: Ada buys Main Conference (order A, ada@) and a Workshops upgrade (order B, ada@). Her registration is later transferred to Ben. Order B is refunded. `currentHolder` resolves to Ben's registration; the query runs against ben@, which has no orders; `stillPaidElsewhere` is false; Ben's active registration is cancelled and `withdrawOrderEntitlements` strips his app access, although order A is still `paid`. Before this change the query ran on ada@, found order A and skipped the cancel. The correct test is "no other paid order covers either the buyer or the holder", and only the holder is asked.

**2. HIGH — after a transfer, the refund email goes to the wrong person.** `apps/web/src/app/api/stripe/webhook/route.ts:246`

The entitlement withdrawal was correctly redirected to `holderEmail` (line 214), but the email was not. `sendRefundConfirmation` still goes to `outcome.email`, and its body (`scripts/src/lib/email.ts:441`) reads "Your registration is now cancelled, so the badge QR code in the app will no longer scan at the door." Failure: Ada transfers her ticket to Ben, then refunds. Ada is told her badge is dead — it already was, she gave the ticket away — and Ben, whose badge actually stopped scanning thirty seconds ago, is told nothing and finds out at the door. Secondary: line 253 stamps the mail-log row with `outcome.registrationId`, which is now Ben's registration, so Ada's refund receipt files itself under Ben in the per-registration email history.

**3. MEDIUM — `cancelExtraSeats` no longer excludes the order it is refunding, and its comment says it does not need to.** `apps/web/src/app/api/stripe/webhook/route.ts:701`, comment at `:667`

That comment — "The order being refunded cannot appear in that query — it is keyed on the buyer's address, not the seat's" — was true when the query used `seatEmail`. Following the seat to a holder can land on the buyer, and then the refunded order *is* in the result set. Nothing breaks today only because `cancelRegistrationByOrder` has already written `status: 'refunded'` by the time this runs, so the `paid`/`partially_refunded` filter drops it by accident. Failure if that ordering ever changes, or if a new reason leaves the order `paid`: a seat transferred back to the buyer's own address survives a full refund as `active`, which is exactly what the desk scans for. The sibling function at `registrations.ts:502` does filter `d.id !== oid`; this one does not.

**4. MEDIUM — a shared dashboard component change moves the desktop look on 99 screens.** `apps/organizer/src/app/(dash)/ui.tsx:129`

`StatTiles` label went 11px → 12px. It is unguarded by any media query, `StatTiles` is imported by 99 files under `(dash)`, and the stated reason is a mobile legibility one. The brief says keep the desktop look. I checked 1280 (`/tickets`, `/attendees/manage-attendees/attendees`): no overflow, no wrap, no clipping — so this is a judgement call to confirm rather than a break, but it is the only change in the diff that lands on desktop everywhere. Every other visual change is inside `@media (max-width: 767px)` (`globals.css:3366-3376`) or a single screen.

**5. MEDIUM — the app-access fix is keyed on the uid, and the join-code document is gated on the ticket claim, not the uid.** `app/src/lib/data/app-access.tsx:156`, rule at `firestore.rules:934`

`settings/appAccess` asks only for `signedIn()`, so keying on `user?.uid` fixes it properly. `settings/appJoinCode` asks for `isRegistered()` — a custom claim. If that claim is minted or refreshed after the uid exists, the deps array never changes, and `useDocument`'s error path is terminal by design (`app/src/lib/data/use-document.ts:196`, "a denied stream is closed by the SDK and never reopened"). `JoinCodeScreen` then holds `ready === false` forever with no retry control on it, which is the same shape as the bug being fixed one layer up. Verdict PLAUSIBLE rather than confirmed: I did not find an in-app path that mints the claim mid-session, so the window may be empty today.

**6. MEDIUM — the new refund path has no test, and the test that looks like its guard cannot see it.** `tests/commerce/fulfilment.test.ts:302-317`

`grep -rn transfer tests/` returns nothing: `currentHolder` (`scripts/src/lib/fulfilment.ts:215`) and the whole transfer-then-refund path are untested. Worse, the "a registration backed by two orders survives one of them being refunded" test re-implements the `stillPaidElsewhere` query inline against a literal `email` rather than calling `cancelRegistrationByOrder`, so it will keep passing green while asserting behaviour the production code stopped performing (finding 1). Nothing was deleted or weakened — no test file is touched in this diff — but the one regression with money on it has a test that structurally cannot fail.

**7. LOW — the `webSlop` fix is a per-call-site patch repeated seventeen times.** `app/src/components/a11y.ts:62`

The rule is now enforced by a comment: "Every `hitSlop` in this app has to be paired with a call to this." There are 17 `webSlop(` calls across 10 files and 44 `hitSlop` sites remaining, plus five near-duplicate slop-constant blocks (`community/[id].tsx:37`, `community/index.tsx:71`, `home/index.tsx:81`, `section-card.tsx:7`, `whova-header.tsx:19` and `:42`). The brief asks for the cause fixed once in a shared place; a helper returning both props, or a `Tappable`, would be that. As written, the eighteenth `hitSlop` someone adds is silently wrong on web again.

**8. LOW — a column renamed away from what its cells contain.** `apps/organizer/src/app/(dash)/tickets/question-form-screen.tsx:345`

"Question id" became "Removed question" and `<code>` became `<span>`, but the cell still renders `o.id`. The organizer now reads a heading promising a question and gets an opaque key, with nothing telling them it is the id they would match against an export. Dropping the `<code>` styling is right; the heading gave up the one word that made the value usable.

**9. LOW — the de-duplicated lede dropped the full venue on the two pages that ship freight.** `apps/web/src/app/tickets/exhibitor/page.tsx:26`, `sponsor/page.tsx:35`

The duplication was real and the fix is right. The surviving line (`audience-page.tsx:85`) prints `SITE.venueShort` = "Cornell Tech, Roosevelt Island"; the removed lede carried `SITE.venue`, the full address. Exhibitors and sponsors now find "New York, NY" only in the footer.

**Worth keeping — an unintended live fix.** `registrations.ts:475`. `if (!holder) return { ...details, registrationId: null }` also removes a 500. An abandoned multi-seat cart writes a `pending` order with the buyer's address but no registration (`apps/organizer/src/app/(dash)/tickets/ticket-setup/1-6-abandoned-registration/page.tsx:29`); `checkout.session.expired` then ran `.update()` on a non-existent registration and threw NOT_FOUND out of the handler, so Stripe took a 500 and retried for three days. It deserves a test before someone reads the early return as dead code.

**Checked and clean:** no change to `firestore.rules`, auth, or `ensureRegistration`; no secrets, credentials or env values added to code or logs; no test file modified or deleted; no two agents editing the same file or the same hunk (`globals.css` has one hunk, inside the existing `@media (max-width: 767px)` block at `:2944`); `/tickets/options/layout.tsx`'s `notFound()` gate is compile-time and nothing links to that segment or to `/tickets1`; the scanner's `outcome === 'ok' || 'duplicate'` test covers the union exactly (`ok | duplicate | unknown | cancelled`, `scanner.tsx:72`); the sortable-header `align-items` works because the anchor carries `display: flex` inline (`ui.tsx:227`).

---

**Check results**

| Check | Result |
|---|---|
| `npx tsc --noEmit` in `apps/organizer` | pass, 0 errors |
| `npx tsc --noEmit` in `apps/web` | pass, 0 errors |
| `npx tsc --noEmit` in `app` | pass, 0 errors |
| `npm test` (root) | 52 files, 944 tests, all pass, 1.41s |
| `FIRESTORE_EMULATOR_HOST=localhost:8080 npx vitest run tests/rules` | 3 files, 321 tests, all pass, 16.5s |

Visual proof: `/tickets`, `/tickets/exhibitor`, `/tickets/sponsor` at 390 — `horizontalScroll: false`, `overflowing: []`, `clipped: []`, 0 em dashes on all three; the exhibitor screenshot shows the date and venue line exactly once. Dashboard `/attendees/manage-attendees/attendees` and `/tickets/ticket-setup/1-3-confirmation-emails` at 390 — no horizontal scroll, and the filter chips and sort links no longer appear in `smallTaps` (the CSS change works; the 16px row checkboxes and the 88×16 "Event website" link remain, both outside this diff). Same two screens at 1280 — no horizontal scroll, no overflow, no clipping, nav tree and table layout unchanged. Screenshots and metrics in `/private/tmp/claude-501/-Users-hartigan-Documents-Claude-Projects-KGC/ce473dc2-4864-489c-bc7b-43704d7578c0/scratchpad/audit/rev390`, `rev-d390`, `rev-d1280`.