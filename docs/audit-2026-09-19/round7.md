# Gate fixes
All three findings are fixed, tested, mutation-checked and driven in the real apps.

## Finding 1, the gated URL in the response

`apps/web/src/lib/watch.ts` no longer exports the records at all. `sessionWatch()` is private; the one export is `sessionWatchPanel(sessionId, viewer, nowMs)`, which returns the new `SessionWatchView` from `packages/shared/src/watch-view-core.ts` — two decided `WatchView`s plus the non-secret display facts (stream state, duration, window). `page.tsx` reads the pass first, computes the view server side, and passes `watch` + `passTicketType`; `watch-panel.tsx` no longer calls `streamView`/`recordingView` and no longer imports `SessionWatchData`. The page cannot hold the record, so it cannot send it.

**Mutation check.** Re-exported `sessionWatch`, added it back as a `raw` prop. Dev response, no cookie at all: `"raw":{"stream":{"provider":"youtube","embedUrl":"https://www.youtube.com/embed/9bZkp7q19f0",...}}`. Restored, gone. Test side: `sessionWatchView` in `watch-view-core.test.ts` deep-scans everything the function returns for the embed URL and stream id; adding the record back beside the decision fails it.

**Proof, and one correction to the reviewer.** I answered the question they could not. Same dev server, same data, HEAD versus fixed, signed out:

| | gated session | clinical-trial session |
|---|---|---|
| HEAD | `9bZkp7q19f0`×4, `148751763`×2, vimeo×1 | `76979871`×2, vimeo×1 |
| fixed | `9bZkp7q19f0`×2 | none |

Production build (`next build` + `next start` in a scratch tree at the same relative depth, symlinking `app/`, `packages/`, `scripts/`; the dev `.next` never touched): **no hits at all**, signed out or with a Virtual ticket, and an entitled Main Conference cookie still gets both iframes. So the reviewer's debug-props carrier is indeed dev-only.

But the old design was one line from shipping it. I added `'use client'` to the *old* panel and rebuilt for production: `9bZkp7q19f0`×2, `148751763`×2, `player.vimeo.com`×1 to a visitor with no cookie. The same directive on the *fixed* panel leaks nothing. That is the thing worth having.

**One thing I did not fix, because this page cannot.** The residual `9bZkp7q19f0`×2 in dev is React's server async-debug channel recording the value each server `await` resolved to — the payload carries `"env":"Server"` and a stack naming `sessionWatch` → `sessionWatchPanel` → `SessionPage`, and the value is the Admin SDK's raw REST document (`{"stringValue":...}`). It is triggered by reading the document, not by passing it, so no restructuring removes it. It is not specific to the gate: `/tickets` and `/agenda` carry the same chunk in dev and none in the production build. Treat it as "the dev server must never be exposed", not as a gate defect.

## Finding 2, the Virtual tier

New `packages/shared/src/watch-promise-core.ts` decides by what a tier sells: `tierPromisesWatching(tier, kind)` reads the bullet list and the group headings as well as `includesVideoLibrary`. Phrases are deliberately narrow — "The Friday watch party" and "One Main Conference pass for booth staff" are real lines in the catalogue and match nothing. Result: streams are owed to All Access (VIP) and Virtual; recordings to those two plus Main Conference, Gold and Platinum. Main Conference sells "streamed on demand", which is a recording, so it is still excludable from a live stream. Workshops and the exhibitor tiers stay fully excludable, which is the point of the control.

`watchPromiseTicketNames()` in `apps/organizer/src/lib/streaming.ts` returns both lists from one read (replacing `videoLibraryTicketNames`). Both save actions now apply it — `saveStreamAction` restored nothing before. Both forms name the tiers and why, and each guaranteed tier's checkbox reads `Virtual · always included`. Streaming Setup gained a "Tickets that always get in" panel for the same reason, since that is the screen read across all seventy-two sessions.

**Mutation check.** Reverting `tierPromisesWatching` to the flag alone fails 4 tests, including "reads the Virtual tier's own bullets, which the video-library flag misses" and "names the two tiers sold a live stream". Restored byte-for-byte.

**Driven.** Re-saved both restricted sessions through the real dashboard. Save message: *"Virtual was added back, because that ticket is sold recordings."* Stored arrays now carry `Virtual`. On the website with a Virtual cookie, both sessions play the stream and the recording; before this, the reviewer proved Virtual was refused both. A Workshops cookie is still refused, with the tier list naming Virtual.

**Left undone, deliberately:** the rule applies on save. The gate is the stored `allowedTicketTypes` array, which `firestore.rules` compares directly, so a restriction written before this stays wrong until re-saved. I re-saved both in the emulator. Nothing is authored on live yet.

## Finding 3, the pointer

`claimRegistrationPointer(db, uid, registrationId)` now lives in `app/src/lib/data/registrations.ts`, beside the two lookups it depends on. `app/src/lib/data/registration-pointer.ts` acquires it, and `AuthProvider` mounts `<RegistrationPointer/>` above every screen. The badge hook keeps `claimedByUid` and no longer writes the pointer, so there is one writer.

One thing worth knowing: my first attempt called the hook in `AuthProvider`'s own body, and it wrote nothing. `useCollection` reads the auth context to decide whether it may open a listener, so from inside the provider it read the default — no user, still loading — and held forever. I found that by instrumenting the running app, not by reading it. That is why it is a child component now, and the reason is written into both files.

Retry and bookkeeping moved to `registration-pointer-core.ts`: the key is recorded **on success, not on attempt**, failures are counted, and they run out at three so an account with no ticket cannot loop against the rules.

`ticketSentence` in `watch-core.ts` no longer contradicts the gate: if the reader's own ticket is in the allowed list and they were still refused, it says so and points at the Me tab instead of insisting their ticket covers it.

**Mutation checks, three.**
- Remove the covered-ticket branch from `ticketSentence` → 2 tests fail, including "does not tell a refused reader that the ticket they hold covers it".
- Record the key on the attempt rather than the success in `nextPointerMemory` → "still owes the write after one failure" fails.
- Change the field `claimRegistrationPointer` writes from `registrationId` to `registration` → 3 rules tests fail, including "gets in once the app stores it, with no other change". `tests/rules/session-watch.test.ts` imports the app's own write rather than re-spelling it, so the test and the code cannot drift.

**Driven.** Cleared `users/46lH0tJx5jvfB9iT0upLBbCyggQ3.registrationId`, signed in at :8081, went login → Home → a gated session, never opening Me or Badge. The pointer came back as `reg_01e1621469460b03d253854f`, and the screen reads honestly (Rune holds Startup Table, which genuinely is not on the list, so it names the ones that are). Repeated after the core refactor. No horizontal overflow at 390.

## Files

New: `packages/shared/src/watch-promise-core.ts` + `.test.ts`, `app/src/lib/data/registration-pointer.ts`, `registration-pointer-core.ts` + `.test.ts`, `scripts/ops/backfill-registration-pointer.mjs`.

Changed: `packages/shared/src/{watch-view-core.ts,watch-view-core.test.ts,index.ts}`, `apps/web/src/lib/watch.ts`, `apps/web/src/app/agenda/[id]/{page.tsx,watch-panel.tsx}`, `apps/organizer/src/lib/streaming.ts`, `apps/organizer/src/app/(dash)/content/agenda-center/session-manager/{watch-actions.ts,watch-form.tsx,[id]/page.tsx}`, `apps/organizer/src/app/(dash)/virtual-and-hybrid/online-session-manager/streaming-setup/page.tsx`, `app/src/lib/{auth/auth-provider.tsx,data/registrations.ts,data/badge.ts,data/watch-core.ts,data/watch-core.test.ts}`, `tests/rules/session-watch.test.ts`. No commits. Other agents' in-flight work in `watch-core.ts`, `watch-form.tsx`, `streaming-setup/page.tsx`, `streaming.ts` and `firestore.rules` is untouched and integrated cleanly.

## Checks

`npm test` 66 files / 1177 tests pass. `FIRESTORE_EMULATOR_HOST=localhost:8080 npx vitest run tests/rules` 5 files / 366 pass. `npx tsc --noEmit` clean in `app`, `apps/web`, `apps/organizer`.

## One thing I did wrong

While cleaning up the scratch production server I ran `pkill -f next-server`, which also killed the two Next dev servers on 3200 and 3100. I restarted both with `FIRESTORE_EMULATOR_HOST=localhost:8080` against their existing `.next`; all three servers answer 200, the dashboard signs in, the website renders its agenda and session pages, and the app signs in and shows the watch blocks. Their build output was never written to by the scratch build, which lived outside the tree.

## Must be run or deployed against live

1. **`firestore.rules`** still has to be published with `scripts/ops/deploy-rules.mjs`. Unchanged by me, still the one blocking deploy.
2. **`scripts/ops/backfill-registration-pointer.mjs` must be run once against live**, after the app ships. Existing accounts have no pointer and are refused every restricted video until they next open the app. It refuses to run when `FIRESTORE_EMULATOR_HOST` is set, requires `GOOGLE_APPLICATION_CREDENTIALS`, requires `--project kgc-conference-app-and-website` spelled out and matching the environment, and is a dry run unless given `--write`. I did not run it, against live or anywhere.
3. **Any watch restriction already stored on live** needs one re-save through the session editor to pick up the tiers that were sold watching. I believe nothing is authored there yet, but I could not check live and did not try.

# Leads, caching, polish
All checks green. Final report:

---

## Findings

**FINDING 4 — "Stop this stand's links" showed a working link.** The row minted a token as it rendered, and revocation can only refuse tokens minted *before* it, so a "stopped" tag always sat beside a live link. Split the two facts the screen was collapsing: `ExhibitorDoc.leadLinkIssuedAt` (a link was handed over) is now separate from `leadLinkSentAt` (a mail was accepted), and `leadLinkState()` in `packages/shared/src/leads-core.ts` turns them into one of `stopped` / `emailed` / `issued` / `none` plus a `showLink` flag. A stopped stand prints "No link works for this stand. Send them one to start again." and pressing Send issues a new link, which lifts it out of the state — so the tag, the action and the address column cannot disagree. Verified on screen: Graphwise and Ontotext Labs both read *stopped* with no link; the other three read *not sent* with one.
*Mutation:* made `stopped` return `showLink: true` → `packages/shared/src/leads-core.test.ts` failed "shows no link at all once a stand's links are stopped" and "is stopped for a stand that was revoked before it was ever issued one".

**FINDING 5 — "Link sent to X" was stamped whether or not a mail left.** `send()` in `scripts/src/lib/email.ts` now returns `SendOutcome` (`sent` / `skipped` / `failed`) from the same branch that writes the log row, and all fourteen templates return it. `sendOutcomeMessage()` builds the sentence; `skipped` keeps the wording this project already uses when sending is off, and `failed` is shaped the same way. `sendLeadLink` stamps `leadLinkSentAt` only on `sent`. The webhook and the invoice action still ignore the value, which the file's header now says explicitly.
*Proved live:* pressed Send on the running dashboard for Cornell Tech Careers — banner read "The email to dana@cornelltechcareers.example.invalid was refused, so nothing arrived. Copy the link from the row and send it yourself.", `emailLog` row `failed`, `leadLinkSentAt` unset, `leadLinkIssuedAt` set. (Residue removed afterwards.)
*Mutation:* made the `failed` branch return the success sentence → `scripts/src/lib/email-outcome.test.ts` failed "says nothing arrived when the provider refused the address" and "tells the reader what to do instead in every case that is not a send".

**FINDING 6 — the recording window was not a boundary.** `windowIsOpen()` added to the `watch` match in `firestore.rules`, comparing `availableFrom` / `availableUntil` against `request.time` (no access call, so the budget is unchanged). Absent means open in both directions, matching `recordingWindow()`. The app no longer *asks* for a document it knows is closed: `useSessionWatch` reads `SessionDoc.recordingUntil` (already denormalised, not secret) and `recordingPanel` renders "This recording closed on 31 December 2027" ahead of both `none` and `denied` — otherwise a closed library would read as "not on your ticket" to somebody whose ticket did include it.
*Mutation (rules):* dropped `windowIsOpen()` from the `allow get` → `tests/rules/session-watch.test.ts` failed "is refused the day after the library closed, ticket or no ticket" and "is refused before it opens". *Mutation (app):* disabled the closed branch → `watch-core.test.ts` failed "says the library closed, not that the ticket is wrong" and "still draws the block when the reader never asked".

**FINDING 7 — `_redirects` claimed ~200 addresses nothing validated.** Added `exhibitor` and `speaker` (two real routes that were shadowing pages silently) to `RESERVED_PAGE_SLUGS`, and a new `REDIRECTED_PAGE_SLUGS` with the 103 single-segment sources in `_redirects`. `slugProblem()` refuses both, with different wording so the organizer knows which collision they hit. `tests/parity/reserved-slugs.test.ts` reads `apps/web/src/app/` and `apps/web/public/_redirects` and fails if either list falls behind — the dashboard and site are separate installs, so nothing else can compare them.
*Mutation:* removed `"program"` → failed "reserves every old address the site still redirects" and "tells an organizer which of the two kinds of collision they hit".

**FINDING 8 — ticket renames break snapshotted names. NOT FIXED.** The honest fix is ids rather than names in `allowedTicketTypes` / `eligibleTicketTypes` / `visibleToTicketTypes`, which is a migration across three clients, the rules and existing registrations, not an edit. Renaming a tier after orders exist still locks pre-rename buyers out silently. It is now *visible*, though: the new "People holding it" column (below) shows a tier nobody holds as zero and a stranded name as its own row, which is what a rename produces.

**FINDING 9 — "Who can watch" unioned two different restrictions.** `watchAudienceLines()` in `stream-core.ts` returns one labelled line per thing there is to watch and collapses to one unlabelled line only when they genuinely agree. On screen the clinical-trial row now reads "Stream: Everybody with a ticket / Recording: All Access (VIP), Main Conference, Gold, Platinum, Virtual".
*Mutation:* restored the union → `stream-core.test.ts` failed "never lets a gated recording make an open stream look gated" plus two others.

**FINDING 10 — two untrue comments.** `leads-core.ts` now cites `matchCode` (the real function). The `appAccess()` docblock's access-call budget was recounted: the heaviest path is a gated `watch` get at seven of ten, not a seat write at six.

## Screens verify

- **1** — same as finding 5.
- **2 (a failed save threw away what was typed)** — `keepTyped()` in `watch-form.tsx` reads the `FormData` on the client before sending, and puts it back into form state only when the save failed. React 19 resets uncontrolled inputs after a form action and `defaultValue` came from `existing`, so a validation error blanked a new form or reverted a saved one. An `attempt` counter is in the field keys because React ignores a new `defaultValue` on a kept DOM node. Nothing refused is written anywhere; the server action is untouched.
- **3 and 4 (wrong "Sold" number; three people in no list)** — Attendee Video Access now counts active registrations by `ticketType` (`ticketHolderCounts()`), which is the field the rules compare, instead of `quantitySold`, which counts orders. It reads All Access (VIP) 11, Main Conference 6, Startup Table 5 where it used to read 0/2/0. `Standard` (2) and `Added by organizer` (1) appear as rows marked "not a ticket type you sell", above a banner saying no checkbox can include them and what to do. *Mutation:* dropped the stray rows → `ticket-audience-core.test.ts` failed "surfaces a tier somebody holds that no checkbox can offer".
- **5 (revoked booth link showed order-confirmation copy)** — new `apps/web/src/app/exhibitor/[token]/not-found.tsx`: "This link no longer opens", why, and how to get another. The site 404 no longer explains claim codes to the six kinds of link that land there. Checked at 390.
- **6 (consent promises company and job title, CSV delivers neither)** — **NOT FIXED.** The lookup is correct; the seeded account Rune signs in with has empty `company` and no title, so the data is genuinely absent. Making the consent wording narrower would change what every future lead records, and the fallback chain already covers the case where a real profile carries them. Left as a data gap.
- **7** — belongs to security finding 2, skipped.
- **8** — Streaming Setup dates now read "Thu, May 6 · 11:00" instead of a raw stored value; Stream and Recording both say "Not set up" instead of "Not set up"/"None"; the Send and Stop dropdowns share one label function so a cancelled stand is "cancelled" in both; the recording date hints explain why they are UTC; the eleven ticket checkboxes are grouped attendee → sponsor → exhibitor then by sell order; the lead desk's `07:12 PM` now uses `leadTimestamp` like the list and the spreadsheet beside it. **The cookie banner over the Watch card at 390 is not fixed** — it is in the website session page the security agent is editing for finding 1.
- **9 (denied state had no next step)** — a refused panel in the app now carries a "See tickets" button to `publicSiteOrigin()/tickets`, matching what the website already does. Shown only on a refusal, not on a closed library or an unstarted stream.

## 4. Caching

**Measured on production builds served side by side** (`WEB_DIST_DIR` into `.next-before` / `.next-after`, both against the emulator, both on their own port, never touching `.next` or :3200). Mean TTFB of 10 requests, milliseconds:

| path | before | after |
|---|---|---|
| `/` | 24.3 | **1.5** |
| `/agenda` | 27.0 | **21.8** |
| `/speakers` | 6.8 | **1.2** |
| `/sponsor` | 9.0 | **1.1** |
| `/exhibitors` | 7.1 | **1.1** |
| `/faq` (custom page) | 4.9 | **3.2** |
| `/documents` | 5.5 | **1.0** |
| `/rooms` | 7.1 | **1.4** |

⚠️ **Next's dev server disables both the route cache and `unstable_cache`**, so the same measurement on :3200 does not move — I checked, and a write showed up on the next request. That is why the numbers above come from real builds. Locally Firestore is a millisecond away; on the live site those same saved queries are round trips to `nam5`, which is what the 0.81–0.95s agenda is made of.

Two layers:
- **`shared()` in `apps/web/src/lib/data.ts`** — `safely()` with `unstable_cache` in front, tagged, 30s. Failures are thrown inside and caught outside, so a fallback is never cached.
- **`revalidate = 30`** on the eleven pages with no per-request input: home, speakers, sponsor, exhibitors, documents, rooms, code-of-conduct, hcls, call-for-posters, startup-pitch, `[slug]`.

**Thirty, not sixty, because the two windows stack.** With both at 60 I measured a published page appearing 35s later and the ceiling was 120s, not 60. Both at 30 puts the ceiling at 60s; a worst-case probe (warm both caches to the top, then write) measured **29s**. That is inside the minute, so no on-demand webhook. Every entry carries a `site-content` tag, so on-demand invalidation is a route handler away if the owner wants it.

**Twenty-nine pages stay `force-dynamic`, each with a one-line reason above it**: capability tokens (`order`, `exhibitor`, `speaker`, `review`×2, `consent`, `submit/token`, `u`), `agenda/[id]` (reads the ticket-pass cookie — a cached response is one served to somebody with a different ticket), every ticket and checkout page (prices and remaining stock; `catalogue.ts` refuses to degrade for the same reason), `/agenda` (`?day=` and `?track=`, but its data is cached), and `/announcements` + `/rooms/[roomId]` — the wall board and the room sign, which already refresh themselves every 60s and would only stack staleness. `listAnnouncements` and the signage read are deliberately left uncached for the same reason.

## 5. Dev indicator

`devIndicators: false` in both `next.config.ts`. Both dev servers restarted and screenshots of localhost:3200 and localhost:3100 show no circle. Local only; the deployed sites never had it.

I also added `distDir: process.env.WEB_DIST_DIR || '.next'` to `apps/web/next.config.ts` so a build can be made beside a running dev server instead of on top of it — that is the collision AGENTS.md says costs half an hour each time. Unset, which is every deploy, it is exactly what it was.

## Files changed

`firestore.rules` · `packages/shared/src/{models,leads-core,stream-core,custom-pages-core}.ts` + `{leads-core,stream-core}.test.ts` · `scripts/src/lib/email.ts` + new `email-outcome.test.ts` · `apps/organizer/src/lib/{exhibitor-leads,streaming,time,time-core}.ts` + new `ticket-audience-core.ts`/`.test.ts` · four organizer screens (`exhibitor-manager/{page,lead-forms}`, `session-manager/{[id]/page,watch-form}`, `streaming-setup/page`, `attendee-video-access/page`) · `app/src/lib/data/{watch,watch-core}.ts` + `watch-core.test.ts`, `app/src/components/{session-watch,video-embed,icon}.tsx` · `apps/web/src/lib/{data,email}.ts`, `apps/web/src/app/not-found.tsx`, new `exhibitor/[token]/not-found.tsx`, `exhibitor/[token]/{page,scan-desk}.tsx`, 30 page files for caching, both `next.config.ts` · new `tests/parity/reserved-slugs.test.ts`.

## Checks

`npm test` 66 files / 1177 tests · `FIRESTORE_EMULATOR_HOST=localhost:8080 npx vitest run tests/rules` 5 files / 366 tests · `npx tsc --noEmit` clean in `app`, `apps/web`, `apps/organizer`, `scripts` · `npx expo export` clean for ios and android · all changed screens at 390 with no horizontal scroll, no overflow, no console errors. Nothing committed.

Two things to flag: **the dev servers on :3100 and :3200 died at 19:49** (both logs end with a clean terminate in the same second; a stray `next start -p 3299` appeared at the same moment, not mine) and I brought them back on the same ports with `FIRESTORE_EMULATOR_HOST` set, since `apps/web/.env.local` otherwise points at the live project. And `next build` rewrote `apps/web/tsconfig.json`; I restored it to HEAD with `git checkout -- apps/web/tsconfig.json`, which is the one working-tree git command I ran.

## Needs to reach the live project

1. **`firestore.rules` must be deployed** — now for two reasons: the `watch` block the streaming work already required, and the availability window in `windowIsOpen()`. Until then a recording's expiry is a caption on three clients and nothing else. `scripts/ops/deploy-rules.mjs`, human identity, not run.
2. **No new indexes.** `ticketHolderCounts()` is one `where('eventId')` and groups in memory.
3. **Resend domain verification** is now more visible, not less: every dashboard Send button will say a mail was refused instead of claiming it arrived. That is the truth, and it will look like a regression to anyone who thought those sends were working.
4. **Existing exhibitor rows have no `leadLinkIssuedAt`**, so a stand that was sent a link before today reads "not sent" until the next Send. Harmless — the link printed still works and Send re-issues — but worth knowing before somebody reports it.

# Adversarial verification
Verification complete. Report below.

---

# Adversarial verification, round 6 streaming findings

## 1. THE LEAK — **still open in development, closed in production**

Two sessions were used. `G` = `a-graph-catalogue-for-machine-learning-features-7c558cc1` (stream gated to All Access (VIP) / Main Conference / Virtual, id `9bZkp7q19f0`; recording gated, Vimeo `148751763`). `C` = `a-knowledge-graph-for-clinical-trial-matching-3bedd223` (stream open, `dQw4w9WgXcQ`; recording gated, Vimeo `76979871`). `dev` = the running dev server on :3200. `prod` = a real `next build` served by `next start` on :3299 from the same working tree.

| # | Path tried | Viewer | Result |
|---|---|---|---|
| 1 | `GET dev /agenda/G` | no cookie | **LEAK.** `9bZkp7q19f0` ×2, `https://www.youtube.com/embed/9bZkp7q19f0` in the body |
| 2 | `GET dev /agenda/C` | no cookie | **LEAK.** `dQw4w9WgXcQ` ×2 |
| 3 | `GET dev /agenda/G` | Startup Table cookie (wrong ticket) | **LEAK.** `9bZkp7q19f0` ×2, no `watch-frame`, page correctly says "not included" |
| 4 | `GET dev /agenda/G` `RSC: 1` | no cookie / wrong ticket | **LEAK.** `9bZkp7q19f0` ×2 in the flight payload both times |
| 5 | `GET dev /agenda/taxonomy…` | All Access, recording window closed 2026-03-01 | **LEAK.** `jNQXAC9IVRw` ×2; copy correctly says "no longer available", no frame |
| 6 | `GET prod /agenda/G` | no cookie | clean. 0 hits for every id, every embed host, `embedUrl`, `watchUrl` |
| 7 | `GET prod /agenda/C` | no cookie | clean |
| 8 | `GET prod /agenda/G` | Startup Table cookie | clean |
| 9 | `GET prod /agenda/G` `RSC: 1` | no cookie / wrong ticket | clean |
| 10 | `GET prod /agenda/C` | Startup Table cookie | `dQw4w9WgXcQ` present — correct, that stream is open to every ticket; restricted `76979871` absent |
| 11 | `GET prod /agenda/G` | Virtual cookie | plays both, 4 `watch-frame`, both ids present — correct |
| 12 | `GET prod /agenda/taxonomy…` | All Access, window closed | clean, "The recording is no longer available" |
| 13 | `GET dev+prod /agenda` (list) | no cookie, wrong ticket | clean |
| 14 | `GET dev+prod /`, `/rooms` | wrong ticket | clean |
| 15 | `GET dev+prod /agenda/G/calendar.ics`, `/sitemap.xml` | none | clean |
| 16 | Firestore `get` as Rune (Startup Table, pointer present) | real client, real ID token | `G/stream` `permission-denied`, `G/recording` `permission-denied`, `C/recording` `permission-denied`, `C/stream` READ OK (open) |
| 17 | Firestore `get` as a brand-new Virtual account, **no profile pointer** | real client | every gated doc `permission-denied`; open docs OK |
| 18 | Same account after the pointer exists | real client | all four gated docs READ OK — correct, Virtual is entitled |
| 19 | Same account, pointer aimed at **someone else's** registration | real client | gated docs `permission-denied` |
| 20 | `getDocs(collection(sessions/G/watch))` | signed-in attendee | `permission-denied` |
| 21 | `collectionGroup('watch')` limit 20 | signed-in attendee | `permission-denied` |
| 22 | `get sessions/G` (the session doc itself) | signed-in attendee | readable, zero url/embed/video/source fields |
| 23 | Attendee app, denied session, every network response inspected | Rune, wrong ticket | no response carries any gated id; rendered DOM carries none |

**Verdict: the finding as written is closed; a second carrier of the same document is still open in development.**

What the agents fixed is real and I confirmed it: the decision now happens in `page.tsx`, and the React props debug chunk that round 6 named carries only the decision —

```
c8:{"name":"WatchPanel",…,"props":{"watch":{"live":{"kind":"blocked","block":"no-ticket",
    "allowedTicketTypes":["All Access (VIP)","Main Conference","Virtual"]},…}}}
```

But two chunks earlier in the same signed-out dev response:

```
a5:[["sessionWatch","webpack-internal:///(rsc)/./src/lib/watch.ts",26,104,19,1,false],…]
a6:{"embedUrl":{"stringValue":"https://www.youtube.com/embed/9bZkp7q19f0",…},
    "videoId":{"stringValue":"9bZkp7q19f0",…},…}
aa:["sessions","a-graph-catalogue-for-machine-learning-features-7c558cc1","watch","stream"]
```

That is React's **server IO debug channel**, not props: it records the awaited value of the `db().getAll(...)` call inside `sessionWatch` at `/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/apps/web/src/lib/watch.ts:26` — the raw Firestore `DocumentSnapshot`, `_fieldsProto` and path segments and all. So the fix's own stated rationale, "a page that never holds the record cannot send it", does not hold: `watch.ts` still fetches and awaits the record inside the render, and in dev that alone ships it.

Severity, stated honestly: the deployed sites are production builds, and I proved production carries no debug channel at all (`"env":"Server"` appears 22 times in the dev body and 0 times in the prod body, `"props"` 0 times). The dev server binds all interfaces — `http://192.168.1.202:3200/agenda` answered 200 from the LAN — so the exposure is anyone on the same network as a developer, not the internet.

**No test protects this.** `npm test` runs `scripts/src app/src packages/shared apps/organizer/src/lib tests/qr tests/programme tests/parity`. `apps/web/src` is in none of them and contains no test file. Reverting `page.tsx` to hand `WatchPanel` the whole record would leave all 1177 tests green. The new `sessionWatchView` tests are good and they do fail when mutated (below), but they pin the shape of a pure function, not the page that was the bug.

## 2. THE TIER — **closed**

| Path tried | Result |
|---|---|
| Untick Virtual on the Stream panel, save | Stored `["All Access (VIP)","Main Conference","Virtual"]`. Message: "Virtual was added back, because that ticket is sold live streams." |
| Untick Virtual on the Recording panel, save | Stored with Virtual. Same shape of message |
| Remove the Virtual checkbox from the DOM before submit, both panels | Virtual still restored, message still shown |
| Replay the server action as a raw HTTP POST — captured `next-action: 70a02ed9839dc765861dea2cd1b5daf43c8528c315`, stripped every `_1_allowedTicketTypes=Virtual` multipart part (906 → 791 bytes), posted outside the browser | HTTP 200, response says "added back", stored list unchanged with Virtual in it |
| Virtual attendee in the real app, gated session | Plays. Two iframes, `https://www.youtube.com/embed/9bZkp7q19f0` and `https://player.vimeo.com/video/148751763`, no sideways scroll at 390 |
| Virtual cookie on the production website | Both panels play |
| `tierPromisesWatching` run over the real seeded catalogue | Virtual stream=true recording=true, All Access both, Main Conference / Gold / Platinum recording only, the six non-watching tiers false both ways. No tier that sells watching is missed |

`allowedTicketTypes` is written in exactly one file (`watch-actions.ts`), on both paths, both through `withPromisedTiers`. There is no second writer.

One copy nit: "because that ticket **is sold** live streams" reads wrong. "because that ticket includes live streams" is what it means.

## 3. THE POINTER — **closed**

| Path tried | Result |
|---|---|
| Brand-new Auth account (Virtual ticket, no `users` document at all), signed in, **Home only**, Me never opened | Pointer `reg_bc4d464f643e6d1bd0b3549b` written. `RegistrationPointer` is mounted by `AuthProvider`, so it ran even while the account was still sitting on the event-code screen |
| Same account, straight to the gated session | Both videos play |
| Same account with the pointer aimed at another person's registration — gate refuses, the email lookup still says Virtual, and Virtual **is** on the allowed list | Screen says "Your ticket could not be checked on this device, so this is locked. Check your ticket on the Me tab, then try again." No claim that the ticket covers it |
| Rune (Startup Table, genuinely excluded) | "Watching this session live is included with All Access (VIP), Main Conference and Virtual tickets. Your ticket is Startup Table." plus a See tickets button. Truthful, and round 6's problem 9 is answered |

Same gap as finding 1: **no test fails if `<RegistrationPointer/>` is deleted from `AuthProvider`.** No test file references it; `auth-provider.tsx` has no test. `registration-pointer-core.test.ts` covers the retry bookkeeping only.

## 4. CACHING — **no staleness found, one measurement incomplete**

| Path tried | Result |
|---|---|
| Edit a session title on the dashboard, poll the dev website | `/agenda` 2.7s, `/agenda/{id}` 1.9s |
| Restore the title, poll again | `/agenda` 3.1s, `/agenda/{id}` 4.0s |
| `/speakers`, `/` | never contain a session title — bad targets on my part, not a cache fault |
| Same measurement against the production build | **Not completed.** The emulator died mid-run (see below) |

`listAgenda` is wrapped in `shared()` at 30s and the routes are `force-dynamic`, so the arithmetic allows up to 30s and I measured under 3. The worst case the header itself documents is a `revalidate = 30` page over a 30s read, i.e. 60s, not the "one minute ceiling" it claims to restore — the comment and the numbers disagree by a factor of two in the stacked case. I could not measure that case.

## 5. CHECKS

| check | result |
|---|---|
| `npx tsc --noEmit` in `app` | pass |
| `npx tsc --noEmit` in `apps/organizer` | pass |
| `npx tsc --noEmit` in `apps/web` | pass |
| `npm test` (root) | 66 files, **1177 tests, pass** |
| `npx vitest run tests/rules` against :8080 | **5 files failed**, 366 skipped — every suite timed out in `initializeTestEnvironment`. Not a code fault: a trivial four-line ruleset also failed to load, and `firestore-debug.log` shows `java.lang.OutOfMemoryError: Java heap space` from 20:26:58 |
| Same suite against a clean emulator I started on 8086 | **5 files, 366 tests, pass** |
| `next build` for `apps/web` | succeeds, 94 pages |
| Dev servers after the build | 3100 → 307 to /login (200), 3200 → 200, 8081 → 200 |

### Mutation checks
Run on copies in the scratchpad so the shared tree was never mutated.

- `windowIsOpen()` removed from the `allow get` line, loaded into a throwaway project on the emulator: a recording whose window closed yesterday went from `permission-denied` to **READ OK**. The new test "is refused the day after the library closed" can genuinely fail. Finding 6 is closed and proven.
- `tierPromisesWatching` reverted to the `includesVideoLibrary` flag alone: **4 tests fail**, including "reads the Virtual tier's own bullets, which the video-library flag misses".
- `blocked()` made to carry `embedUrl` again: **5 tests fail**, including "never hands a URL to a blocked viewer" and both `sessionWatchView` leak tests.
- Finding 1 at the page level, and finding 3's mount: **no test to mutate.** See above.

## Anything new

1. **The dev leak has a different carrier than round 6 described**, and it is generic: any Firestore read awaited inside a server render puts the whole snapshot into the dev flight payload. Anything else gated the same way would leak the same way.
2. **`apps/web` has no tests and is in no test command.** That is why both the old and the new version of this leak could ship green.
3. **The shared emulator on :8080 is out of Java heap and is not serving.** Reads and writes over REST and gRPC both time out; `/emulator/v1/…:securityRules` returns 500 for any ruleset. The three servers still answer 200 but the website is serving what it had cached. I did not restart it, per the brief.
4. **A seeded value I could not put back.** For the caching measurement I set `sessions/a-graph-catalogue-for-machine-learning-features-7c558cc1.title` to `A Graph Catalogue for Machine Learning Features QQPROBE`. The emulator stopped accepting writes before I could restore it. Fifteen retries over eight minutes, through REST, the Admin SDK and the dashboard form, all timed out. **It needs restoring to `A Graph Catalogue for Machine Learning Features` once the emulator is back.**
5. `next build` with `WEB_DIST_DIR` pointed outside the repo fails: the generated route types cannot resolve `next/dist/...` from there. It works with a dist dir inside `apps/web`. Both builds also rewrite `apps/web/tsconfig.json`; I reverted it both times and left the file as committed.
6. Copy: "because that ticket is sold live streams" / "is sold recordings" is ungrammatical in the save message.

## Data I left behind

- Auth account `mira.dahl@example.test` / `kgc2027demo`, uid `ZKUhvWDLHqHjmpvWQk86xA3ph09L`, with the `registered` claim, plus its `users/…` profile pointing at `reg_bc4d464f643e6d1bd0b3549b`. Created to test a fresh account; safe to delete.
- Audit rows and unchanged re-saves of the stream and recording on the graph-catalogue session, from the exclusion tests.
- Rules-test project namespaces on the emulator, from the suite runs.
- Removed: `apps/web/.next-audit`, my :3299 server, my :8086 emulator. `git status` shows the same 91 entries as when I started and no stashes; I changed no file in the repo.

Nothing here needs to be run against the live project. Evidence files are under `/private/tmp/claude-501/-Users-hartigan-Documents-Claude-Projects-KGC/ce473dc2-4864-489c-bc7b-43704d7578c0/scratchpad/leak/` — the captured bodies are `nocookie-*.html`, `startup-*.html`, `virtual-*.html` and `p2-*` for production, and the drivers are `gate-probe.mjs`, `fresh-pointer.mjs`, `app-drive.mjs`, `exclude-virtual.mjs`, `replay-action.mjs`, `stale.mjs`, with the mutation checks in `../mut/`.