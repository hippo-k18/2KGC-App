# E — Linkage: does the dashboard reach the app and the website?

**Audited 2026-08-30 against the working tree.** Read-only audit; no source file
was changed. Every claim below is cited to `file:line` and was established by
reading the code, not the docs. Where the docs and the code disagree, the code
wins and the disagreement is called out.

The requirement being audited is the owner's: *"everything on the dashboard is
fully working and corresponds with the backend, to the app, to the website."*

---

## Executive summary

Three surfaces share one Firestore project and one set of document types
(`packages/shared/src/models.ts`, `packages/shared/src/collections.ts`). The
plumbing is genuinely shared — there is no second copy of a collection name and
no second copy of `ensureRegistration`. So the failures are not wiring bugs.
They are **holes**: entities that one surface displays and no surface can
author, and entities the dashboard authors that no surface displays.

Counted from the code:

| | Count |
|---|---:|
| Collections + subcollections declared in `@kgc/shared` | 32 + 18 = **50** |
| The dashboard can create or edit | **15** |
| The dashboard can only append to | **6** |
| The dashboard reads but cannot write | **12** |
| The dashboard never touches at all | **15** |
| Entities the **app** displays that the **dashboard cannot author** | **7** (speakers, sponsors, tracks, rooms, polls, threads, materials) |
| Entities the **dashboard authors** that **nothing displays** | **9** (settings, exhibitors, booths, gatherings, contacts, surveys, tasks, documents, checkInStations) |
| Website pages reading Firestore | **8 of 21** (ROADMAP says 5 — wrong, see §1) |
| Dashboard screens reading Firestore | **~136 of 177** (README says 173 — wrong, see §3 note) |
| Counters rendered in the app that can never move | **5** (`replyCount`, `reactionCount`, `upvoteCount`, poll `tallies`, `totalVotes`) |

**The single largest linkage gap is the programme itself.** `speakers`,
`sponsors`, `tracks` and `rooms` are read by all three surfaces and writable by
none of them. The only way to change a speaker's name today is to re-run
`npm run seed` or edit Firestore by hand. That is the opposite of the stated
requirement, and it sits underneath the two most-visited public pages.

---

## 1. Website pages (`apps/web/src/app/`)

`find apps/web/src/app -name page.tsx` → **21 files**, which confirms the
ROADMAP's page count (`ROADMAP.md:14`). Three additional non-page route
handlers exist and are audited below the table because they carry the money
path.

### ⚠️ Correction to `ROADMAP.md:48`, `:143-145`, `:207`, `:293`

The ROADMAP says **"5 of 21 read Firestore: `/`, `/agenda`, `/sponsor`,
`/tickets`, `/order/{token}`"**. The code says **8 of 21**. The three it misses
are `/tickets/exhibitor`, `/tickets/sponsor` and `/tickets/invoice`, all of
which call `tiersOrNull()` against `ticketTypes` and were shipped by the same
"exhibitor & sponsor ticketing" cluster the ROADMAP itself describes at
`ROADMAP.md:74`. The claim is stale in the *pessimistic* direction, like the
three the ROADMAP already corrected at `:44-49`.

Counting the three route handlers, **11 of 24 route files** touch Firestore.

### 1a. Pages that read Firestore live (8)

| Route | File | Data function(s) | Collections | Cache |
|---|---|---|---|---|
| `/` | `apps/web/src/app/page.tsx:2,4` | `listAgenda()`, `listSponsorsByTier()`, `programmeCounts()`, `tiersOrNull()` | `sessions`, `sponsors`, `speakers` (count only), `ticketTypes` | `force-dynamic` :20 |
| `/agenda` | `apps/web/src/app/agenda/page.tsx:3` | `listAgenda()` → `apps/web/src/lib/data.ts:139` | `sessions` | `force-dynamic` :20 |
| `/sponsor` | `apps/web/src/app/sponsor/page.tsx:2` | `listSponsorsByTier()` → `apps/web/src/lib/data.ts:287` | `sponsors` | `force-dynamic` :12 |
| `/tickets` | `apps/web/src/app/tickets/page.tsx:5,9` | `tiersOrNull()` → `catalogue.ts:103`; `activeForm()` → `question-forms.ts:55` | `ticketTypes`, `questionForms` | `force-dynamic` :23 |
| `/tickets/exhibitor` | `apps/web/src/app/tickets/exhibitor/page.tsx:3` → `apps/web/src/app/tickets/audience-page.tsx:62-63` | `tiersOrNull('exhibitor')`, `activeForm('exhibitor')` | `ticketTypes`, `questionForms` | `force-dynamic` :11 |
| `/tickets/sponsor` | `apps/web/src/app/tickets/sponsor/page.tsx:3` → same component | `tiersOrNull('sponsor')`, `activeForm('sponsor')` | `ticketTypes`, `questionForms` | `force-dynamic` :11 |
| `/tickets/invoice` | `apps/web/src/app/tickets/invoice/page.tsx:3` | `tiersOrNull()` | `ticketTypes` | `force-dynamic` :22 |
| `/order/{token}` | `apps/web/src/app/order/[token]/page.tsx:4,5` | `readOrderToken()`, `getRegistration()` → `registrations.ts:283` | `registrations` | `force-dynamic` :19 |

### 1b. Route handlers that read/write Firestore (3, not "pages")

| Route | File | Functions | Collections |
|---|---|---|---|
| `/r/{code}` | `apps/web/src/app/r/[code]/route.ts:33` | `resolveAndCount()` → `campaign-links.ts:55,69-70` | `campaignLinks` (read + click increment) |
| `/checkout/return` | `apps/web/src/app/checkout/return/route.ts:2-3` | `fulfilPurchase()` → `registrations.ts:152` | `orders`, `registrations` |
| `/api/stripe/webhook` | `apps/web/src/app/api/stripe/webhook/route.ts:3-15` | `incrementSold`, `fulfilPurchase`, `cancelRegistrationByOrder`, `claimAnswers`, `sendPurchaseConfirmation` | `orders`, `registrations`, `ticketTypes`, `pendingAnswers`, `emailLog`, `users`, `directory` |

Server actions on the same site write too: `apps/web/src/app/tickets/actions.ts:36`
(`startCheckout` → `pendingAnswers` via `stashAnswers`, `apps/web/src/lib/question-forms.ts:78`)
and `apps/web/src/app/tickets/invoice/actions.ts:40` (`requestInvoice` →
`recordInvoiceOrder`, `registrations.ts:513`).

### 1c. Pages whose content is hardcoded in the React file (13)

For each, the dashboard screen that would have to own the content. Whova's own
tree already names most of them; `apps/organizer/src/lib/nav.ts` has the slugs.

| Route | File | Hardcoded content | Dashboard owner it needs |
|---|---|---|---|
| `/about` | `apps/web/src/app/about/page.tsx` (179 lines, prose in JSX) | Mission, history, org copy | **CMS page collection** — new `pages/{slug}` model; nav has no home for it, closest is `content/basics` |
| `/blog` | `apps/web/src/app/blog/page.tsx:5` | `POSTS[]` at `apps/web/src/lib/posts.ts:55` (1,222-line array) | **A `posts` collection + a Blog screen.** Nothing in `nav.ts` covers this; Whova has no blog. New surface. |
| `/blog/{slug}` | `apps/web/src/app/blog/[slug]/page.tsx:5` | `getPost()` over the same array | same |
| `/call-for-posters` | `.../call-for-posters/page.tsx:23,32,41` | `TOPICS`, `RULES`, `DATES` | **CMS page collection**, or a "Call for Speakers/Posters" screen (`content/agenda-center/call-for-speakers` exists in `nav.ts`) |
| `/code-of-conduct` | `.../code-of-conduct/page.tsx:29,36,49` | `STANDARDS`, `SANCTIONS`, `COMMITTEE` | **CMS page collection**. ROADMAP names this one explicitly at `:212`. |
| `/community` | `.../community/page.tsx:17,39` | `CHANNELS`, `LIBRARIES` | **CMS page collection** + a link table; unrelated to the in-app `communityPosts` board |
| `/hcls` | `.../hcls/page.tsx:25,32` | `OBJECTIVES`, `STATS` | **CMS page collection**; the stats block should read `programmeCounts()` |
| `/kgc-lifetime-achievement-awards` | `.../page.tsx:18,23` | `CURRENT`, `PAST` | **CMS page collection** |
| `/learn` | `.../learn/page.tsx:34,55,64` | `FOUNDERS`, `ROSTER`, `PROGRAMS` | **CMS page collection**; `ROSTER` overlaps `speakers` |
| `/previous-events` | `.../previous-events/page.tsx:28` | `EDITIONS` | **CMS page collection** |
| `/speakers` | `apps/web/src/app/speakers/page.tsx:2` | `SPEAKERS_2026` at `apps/web/src/lib/speakers-2026.ts:108` (124 people) | **`content/speaker-center/speaker-manager`** — the screen exists and is read-only (`§3`). See Broken link **B2**: this is the one hardcode the dashboard *thinks* it owns. |
| `/startup-pitch` | `.../startup-pitch/page.tsx:29,36` | `DATES`, `REASONS` | **CMS page collection** |
| `/team` | `.../team/page.tsx:19` | `TEAM` | **CMS page collection**; `nav.ts:57` `content/branding-center` is the nearest home |

Plus `/not-found` (`apps/web/src/app/not-found.tsx`), not a content page.

### 1d. Site chrome — hardcoded, and not on anyone's list

`apps/web/src/lib/site.ts` is a single module of strings rendered on **every**
page, and none of it is reachable from the dashboard:

| Export | Line | What it controls | Dashboard owner it needs |
|---|---|---|---|
| `ANNOUNCEMENT` | `site.ts:62` | The bar above the header | `engagement/announcements` — the dashboard already *writes* `announcements`, the website just doesn't read them |
| `TICKER` | `site.ts:76` | The scrolling strip on every page | same |
| `HCLS_BADGE` | `site.ts:95` | Badge on the HCLS panel | CMS / `settings/event-website` |
| `ATTENDEES_EXPECTED` | `site.ts:110` | The "1,000+" stat block | `settings/event-website` |
| `APP_DISTRIBUTION` | `site.ts:125` | The install instructions on the confirmation page — the one page every purchaser reads | `tools/app-adoption/*` |
| `APP_URL` | `site.ts:136` | Where the app is hosted | `content/branding-center/branded-event-url` (which writes `settings/branding` and is never read) |
| `NAV`, `ABOUT_MENU`, `NAV_MORE` | `site.ts:152,189,211` | Site navigation | CMS |

The docblocks are candid that these are "a one-line edit by someone who knows
the answer" (`site.ts:56-60`) — which is true, and is exactly the thing the
owner's requirement rules out. Every one of them is a redeploy.

### 1e. Caching on the website

Clean. No `revalidate`, no `unstable_cache`, no `force-static`, no fetch cache
options anywhere in `apps/web/src` (verified by grep). All eight Firestore pages
carry `export const dynamic = 'force-dynamic'`, so a dashboard price change is
visible on the next request — this is the linkage the demo records
(`demo/README.md:22,40`). The 13 prose pages are statically prerendered at
build, which is correct given they hold no live data, and is precisely why
editing them is a deploy.

One oddity: `apps/web/src/app/speakers/page.tsx:40` declares `force-dynamic`
for a page whose data is a compile-time constant. Harmless, but it is a tell —
that line was written when the page was expected to read Firestore.

---

## 2. Attendee app screens (`app/src/app/`)

**21 screens** plus 7 layout files. Every Firestore read goes through
`app/src/lib/data/use-collection.ts:70` or `use-document.ts:40`, which is the
error-safe listener AGENTS.md mandates.

| # | Screen | File | Collections read | Hook(s) in `app/src/lib/data/` |
|---|---|---|---|---|
| 1 | Router | `app/src/app/index.tsx` | — | none (auth only) |
| 2 | Login | `app/src/app/login.tsx:77,102-103` | — | Firebase Auth; `DEMO_MODE` shortcut |
| 3 | Not found | `app/src/app/+not-found.tsx` | — | none |
| 4 | Home | `app/src/app/(tabs)/home/index.tsx:17-20` | `sessions`, `announcements`, `threads`, `users/{uid}/savedSessions` | `useSessions` `sessions.ts:23`, `useAnnouncements` + `useNowNext` `announcements.ts:20,45`, `useThreads` `messages.ts:50`, `useSavedSessions` `saved-sessions.ts:22` |
| 5 | Coming soon | `app/src/app/(tabs)/home/coming-soon.tsx` | — | none — renders params passed by `home/index.tsx:454` |
| 6 | Q&A / Polls index | `app/src/app/(tabs)/home/session-feature.tsx:13` | `sessions` (filtered on `qaEnabled`/`pollsEnabled`) | `useSessions` |
| 7 | Agenda | `app/src/app/(tabs)/agenda/index.tsx:22,23,32,33` | `sessions`, `tracks`, `savedSessions`, `communityPosts` (meetups, :145) | `useSessions`, `useTracks` `tracks.ts:17`, `useSavedSessions`, `useCommunityPosts` `community.ts:60` |
| 8 | Session detail | `app/src/app/(tabs)/agenda/[id].tsx:34,99` | `sessions/{id}`, `speakers/{id}`, `savedSessions`; renders `SessionPoll` :306 and `SessionQA` :308 | direct `doc()` + `useSavedSessions` |
| 9 | People | `app/src/app/(tabs)/people/index.tsx:28` | `directory`, `speakers`, `sponsors`, `users/{uid}/savedContacts` | `useDirectory` `directory.ts:35`, `useSpeakers` :82, `useSponsors` :94, `useSavedContacts` :119 |
| 10 | Attendee detail | `app/src/app/(tabs)/people/[uid].tsx:57-58` | `directory/{uid}` | `useDocument` |
| 11 | Speaker detail | `app/src/app/(tabs)/people/speaker/[id].tsx:48-49` | `speakers/{id}`, `sessions` | `useDocument`, `useSessions` |
| 12 | Sponsor detail | `app/src/app/(tabs)/people/sponsor/[id].tsx:54-55` | `sponsors/{id}` | `useDocument` |
| 13 | Community board | `app/src/app/(tabs)/community/index.tsx:19,27` | `communityPosts`, `announcements`, `.../replies` (counted) | `useCommunityPosts`, `useAnnouncements`, `useReplyCounts` `community.ts:115` |
| 14 | Post detail | `app/src/app/(tabs)/community/[id].tsx:51-52` | `communityPosts/{id}`, `.../replies`, `.../reactions` | `useDocument`, `useReplies` :166, `useMyReactions` :266 |
| 15 | Announcements | `app/src/app/(tabs)/community/announcements.tsx:10` | `announcements` | `useAnnouncements` |
| 16 | Me | `app/src/app/(tabs)/me/index.tsx:18,19,80,91` | `savedSessions`, `threads`; **writes** `users/{uid}` and `directory/{uid}` (privacy) | `useSavedSessions`, `useThreads` |
| 17 | Profile | `app/src/app/(tabs)/me/profile.tsx:16,77,93` | `tracks`; **writes** `users/{uid}` + `directory/{uid}` | `useTracks` |
| 18 | My schedule | `app/src/app/(tabs)/me/schedule.tsx:12,13` | `sessions`, `savedSessions` | `useSessions`, `useSavedSessions` |
| 19 | Badge | `app/src/app/(tabs)/me/badge.tsx:17` | `registrations` (by email, `badge.ts:269`), `checkInLists/event-door/checkIns/{regId}` (`badge.ts:391-395`); **writes** `registrations.claimedByUid` (`badge.ts:352`) | `useBadge` `badge.ts:223`, `useCheckInStatus` :384 |
| 20 | Messages inbox | `app/src/app/messages/index.tsx:19,20` | `threads`, `directory` | `useThreads`, `useDirectory` |
| 21 | Thread | `app/src/app/messages/[threadId].tsx:19,20` | `threads/{id}/messages`, `directory`; **writes** messages | `useMessages` `messages.ts:79`, `sendMessage` :124, `markThreadRead` :177 |

Two components carry their own reads and are rendered only from screen 8:
`app/src/components/session-qa.tsx:10-13` (`useQuestions` `qa.ts:46`,
`useAskQuestion` :76, `useMyUpvotes` :111, `useToggleUpvote` :158) and
`app/src/components/session-poll.tsx:9` (`usePolls` `qa.ts:188`, `useMyVote`
:203, `useCastVote` :235).

### 2a. 🚩 Screens reading data no dashboard screen can author

| Screen | Entity | Why it is stuck |
|---|---|---|
| People → Speakers (9), Speaker detail (11), Session detail (8) | `speakers` | Dashboard reads it in five places (`apps/organizer/src/lib/data.ts:191`, `conflicts.ts:57`, `webpages.ts:65`, `messaging.ts:110`, `images.ts:111`) and **writes it nowhere**. `speaker-manager/page.tsx` has no action file; its only `.set(` calls are `URLSearchParams` (`:69-70`). |
| People → Sponsors (9), Sponsor detail (12) | `sponsors` | Same shape — four reads, zero writes. |
| Agenda (7) track filter chips | `tracks` | Read once (`apps/organizer/src/lib/data.ts:152`), never written. |
| Session detail (8) room line | `rooms` | Read three times (`data.ts:91`, `cohorts.ts:68`, `conflicts.ts:58`), never written. The session editor picks an existing `roomId` and denormalises `roomName` onto the session (`session-manager/[id]/actions.ts:106-107`) — so you can *move* a session between rooms but never *create* a room. |
| Session detail (8) → `SessionPoll` | `sessions/{}/polls` | `apps/organizer/src/lib/polls.ts:75` is read-only. An organizer can switch `pollsEnabled` on (`session-qanda-manager/actions.ts:31`) and then has no way to write a poll. |
| Messages (20, 21) | `threads` | The word `threads` does not appear anywhere in `apps/organizer/src` outside the demo fixture. An organizer cannot see, moderate or send a direct message. |
| Home tile "Documents" (4 → 5) | `sessions/{}/materials` | Never written by anything; the tile correctly routes to `coming-soon` (`home/index.tsx:487-495`). |

Everything in that list except `materials` and `threads` is **seeded-only
data**: it exists solely because `scripts/src/seed-demo.ts` put it there
(`speakers` ×6 refs, `sponsors` ×2, `tracks` ×3, `rooms` ×3, `polls` ×1 in
`scripts/src`). Re-running the seed is the edit mechanism.

### 2b. 🚩 Counters that never move

AGENTS.md is right that these are function-owned and the functions are not
deployed (`functions/src/triggers/`, 10 files, none deployed — Blaze). What the
app does with them varies, and one case is worse than the others:

| Counter | Model | Owner trigger | Rendered at | Behaviour today |
|---|---|---|---|---|
| `CommunityPostDoc.replyCount` | `models.ts:472` | `on-reply-write.ts:15` | Community board (13) | **Worked around.** `useReplyCounts` (`community.ts:115`) ignores the field and runs `getCountFromServer` per post, re-run on focus (:119). Correct number, N+1 reads. |
| `CommunityPostDoc.reactionCount` | `models.ts:474` | `on-reaction-write.ts:13` | Community board (13) | Frozen at whatever the seed wrote. No workaround. |
| `SessionQuestionDoc.upvoteCount` | `models.ts:518` | `on-question-upvote-write.ts:15` | `session-qa.tsx:141,151` | **Frozen and load-bearing.** It is both the number on screen *and* the sort key (`qa.ts:63-65`), so the Q&A list is ordered by a value that never changes — tapping upvote writes the `upvotes` doc, the count stays put, and the question never rises. The docblock at `session-qa.tsx:24` admits the first half and not the second. |
| `PollDoc.tallies` | `models.ts:566` | `tally-poll.ts:26` | `session-poll.tsx:80` | Frozen. Bars sit at zero; docblock `session-poll.tsx:17-19` says so and the screen prints the caveat. |
| `PollDoc.totalVotes` | `models.ts:567` | `tally-poll.ts:26` | `session-poll.tsx:52` | Frozen. The dashboard deliberately does **not** read it (`apps/organizer/src/lib/polls.ts:17-27` counts the `votes` subcollection instead) — the app has no equivalent subtraction. |
| `sessions/{}/qaBoard/current` | `models.ts:542` | `rebuild-qa-board.ts:27` | **nothing** | Modelled, written by a task, read by no surface. `qaBoard` appears zero times in `apps/organizer/src` and only in a comment in `app/src/lib/data/qa.ts:39`. |
| `users/{}/notifications` | `models.ts:593` | `on-announcement-create.ts:53`, `on-session-agenda-change.ts:84` | **nothing** | No app screen reads the inbox. `app/src/app/messages/index.tsx:201` tells the user push does not exist. |

Also frozen-adjacent: `mirror-directory.ts:59` would keep `directory` in step
with `users`. It is not deployed, so the app writes both documents itself from
the client (`me/profile.tsx:77,93`; `me/index.tsx:80,91`). That works, and it
means a `users` edit made anywhere *other* than the app — an importer, a
console — will not reach the public directory.

---

## 3. The correspondence matrix

One row per domain entity. **"Dashboard: can author?"** means a Firestore write
exists and a route reaches it. **"Website / App: surfaced?"** means a read
renders it to a human. Collection names are `COLLECTIONS.*` /
`SUBCOLLECTIONS.*` from `packages/shared/src/collections.ts`.

| Entity | Dashboard: can author? | Firestore collection | Website: surfaced? | App: surfaced? | Gaps |
|---|---|---|---|---|---|
| **Session** | ⚠️ Edit only — `saveSessionAction` `session-manager/[id]/actions.ts:55,114` writes title, description, roomId/roomName, status, times only. No create, no delete (rules refuse it, :34-38). `speakerIds`, `trackIds`, `format`, `capacity` unreachable. | `sessions` | ✅ `/agenda`, `/` — `listAgenda()` `apps/web/src/lib/data.ts:139` | ✅ Agenda, detail, Home now/next, My schedule — `useSessions` `sessions.ts:23` | Cannot add a session. Cannot assign a speaker to one. `sequence` bump exists (`actions.ts:117`) but nothing consumes ICS. |
| **Speaker** | ❌ **No writer anywhere** | `speakers` | ⚠️ `/speakers` renders `SPEAKERS_2026` hardcoded (`speakers-2026.ts:108`), **not** the collection. `/` uses it for a count only (`data.ts:304`). | ✅ People→Speakers, Speaker detail | **The worst gap.** Dashboard reads it 5× and writes 0×; the public page ignores it entirely. See B1, B2. |
| **Sponsor** | ❌ No writer anywhere | `sponsors` | ✅ `/sponsor`, `/` — `listSponsorsByTier()` `data.ts:287` | ✅ People→Sponsors, Sponsor detail | Live on two public surfaces, editable only by re-seeding. |
| **Track** | ❌ No writer (`data.ts:152` read-only) | `tracks` | ❌ (session `primaryTrackName` is denormalised onto the agenda) | ✅ Agenda filter chips `useTracks` `tracks.ts:17`; Profile interests `me/profile.tsx:16` | Track colour/name changes require a seed. Denormalised caches `primaryTrackName`/`primaryTrackColor` are owned by the importer (`actions.ts:50-52`) so they would go stale. |
| **Room** | ❌ No writer; `listRooms()` `data.ts:90` feeds a picker only | `rooms` | ❌ | ⚠️ Indirect — `roomName` denormalised onto the session | Cannot create/rename a room. Home "Floormap" tile is `coming-soon` (`home/index.tsx:498-505`). |
| **Ticket type** | ✅ Create + edit — `saveTicketTypeAction` `1-1-create-tickets/actions.ts:77,196`; `toggleTicketVisibilityAction` :267 | `ticketTypes` | ✅ `/tickets`, `/tickets/exhibitor`, `/tickets/sponsor`, `/tickets/invoice`, `/` — `tiersOrNull()` `catalogue.ts:103` | ❌ No in-app purchase or price display | **The one fully-working three-hop link, minus the app.** This is what `demo/README.md:22` records. |
| **Order** | ✅ Create (manual/comp) `manual-orders.ts:104,154`; edit (mark invoice paid) `invoice-admin.ts:41,86`. Refund goes to Stripe (`attendee-orders/actions.ts:58,140`) and returns through the website webhook. | `orders` | ✅ written by webhook + checkout return; `/order/{token}` reads the registration, not the order | ❌ | The app never shows a purchase. `pay/order-details` is a redirect (`page.tsx:16`). Invoice refunds unimplemented (`actions.ts:39-41`). |
| **Registration** | ⚠️ Indirect only — `ensureRegistration` (`scripts/src/lib/fulfilment.ts:84`) via CSV import `import-attendees.ts:107`, manual order `manual-orders.ts:137`, invoice `invoice-admin.ts:71`. No edit or delete UI. | `registrations` | ✅ `/order/{token}` `getRegistration()` `registrations.ts:283` | ✅ Badge screen `badge.ts:269`; app writes `claimedByUid` :352 | Cannot correct a name or email on a registration from the dashboard. |
| **Announcement** | ⚠️ Create only — `sendAnnouncementAction` `engagement/announcements/actions.ts:35,75`. No edit, no delete. | `announcements` | ❌ **The site banner is `SITE.ANNOUNCEMENT`, a constant** (`apps/web/src/lib/site.ts:62`) | ✅ Home + Community + Announcements screen `useAnnouncements` `announcements.ts:20` | See B3. Also: `push: true` writes the flag; nothing sends (`on-announcement-create.ts` undeployed). |
| **Community post** | ⚠️ Moderate only — `moderatePostAction` `community-board/actions.ts:44,33` sets `status`. No organizer posting (screen says so: `discussion-topics/page.tsx:14`). | `communityPosts` | ❌ `/community` is a static channel list (`community/page.tsx:17`) | ✅ Board, detail; attendees author via `createPost` `community.ts:181`, `editPost` :207 | ~~Categories are a hardcoded const in **two** places: `app/src/lib/data/community.ts:36` and `apps/organizer/src/lib/engagement.ts:68-74`. They agree today; nothing keeps them agreeing.~~ **Wrong on both counts, and fixed.** It was **three** copies — the two named plus `community-board/page.tsx:32-39` — and they did **not** agree: the app printed "Meet-ups" and "Travel" where both dashboard copies said "Meet-up" and "Ride share", so a moderator read a category name that appears nowhere in the app. The list now lives beside the ids as `COMMUNITY_CATEGORIES` in `packages/shared/src/community.ts`, `CommunityPostDoc.category` is derived from it, and all three sites import it. The app's wording won: it is the only surface where a human picks a category. |
| **Community reply** | ⚠️ Moderate only — `moderateReplyAction` `community-board/actions.ts:64,76` | `communityPosts/{}/replies` | ❌ | ✅ `useReplies` `community.ts:166`; `addReply` :219 | `replyCount` frozen; app works around it with per-post counts (`community.ts:115`). |
| **Post reaction** | ❌ Never touched | `communityPosts/{}/reactions` | ❌ | ✅ `toggleReaction` `community.ts:237`, `useMyReactions` :266 | `reactionCount` frozen (`models.ts:474`). |
| **Message thread / message** | ❌ **Never touched — `threads` appears 0× in `apps/organizer/src`** | `threads`, `threads/{}/messages` | ❌ | ✅ Inbox, thread, unread badge — `messages.ts:50,79,124,177` | An organizer cannot read, send or moderate a DM. Attendee-to-attendee only. |
| **Attendee profile** | ❌ Read-only (`data.ts:332,441`, `badges.ts:74`, `push.ts:170`) | `users` | ✅ written by `provisionAppAccount` `app-account.ts:139` (demo mode) | ✅ Me, Profile — app writes it `me/profile.tsx:77` | Dashboard cannot fix a misspelled attendee name. |
| **Public directory entry** | ❌ Read-only (`cohorts.ts:144`) | `directory` | ✅ written by `app-account.ts:144` | ✅ People, attendee detail, message recipient names | `mirror-directory.ts:59` undeployed, so only the app keeps it in step (`me/profile.tsx:93`, `me/index.tsx:91`). |
| **Saved session (my schedule)** | ❌ Read-only, collection-group, for push targeting (`push.ts:154`) | `users/{}/savedSessions` | ❌ | ✅ `useSavedSessions` `saved-sessions.ts:22` | Fine — attendee-owned by design. |
| **Saved contact** | ❌ Never touched | `users/{}/savedContacts` | ❌ | ✅ People screen `directory.ts:119` | No export of "who I met" for the attendee, no lead list for the organizer. |
| **Booth** | ✅ Full — `assignBooth`/`releaseBooth`/`setBoothBlocked`/`upsertBooth` `booths.ts:129,235,287,339` | `booths` | ❌ | ❌ | Authored and shown to nobody. An exhibitor who bought a booth cannot see its number anywhere but a dashboard screen. |
| **Exhibitor** | ✅ Create + edit — `saveExhibitorAction` `exhibitor-manager/actions.ts:32,72`; `setExhibitorStatusAction` :125 | `exhibitors` | ✅ `/exhibitors` reads `listExhibitorsByZone()` and is `force-dynamic` | ✅ | ⚠️ Corrected 2026-09-01. This row said "Authored and shown to nobody" and cited a ROADMAP line that was itself stale; the public page exists. Only `status === 'confirmed'` exhibitors are published, and the booth number comes from a `booths` doc with `status === 'assigned'`, not from `ExhibitorDoc.boothNumber`. |
| **Question form** | ✅ Full field editor — `saveField`/`deleteField`/`moveField`/`setFormActive` `question-forms.ts:98,203,243,291` | `questionForms` | ✅ `/tickets`, `/tickets/{exhibitor,sponsor}` — `activeForm()` `apps/web/src/lib/question-forms.ts:55` | ❌ | **Working two-hop link.** Answers land on the registration at fulfilment; the app never shows them back to the attendee. |
| **Pending answers** | ❌ Never touched (server-only by design, `collections.ts` docblock) | `pendingAnswers` | ✅ written `question-forms.ts:78`, claimed `:122` | ❌ | Correct as designed. |
| **Campaign link** | ✅ Create + edit — `saveLink`/`setLinkActive` `campaigns.ts:382,459` | `campaignLinks` | ✅ `/r/{code}` resolves and self-counts `campaign-links.ts:55,69` | ❌ | **Working two-hop link**, and the only counter that moves without Cloud Functions (`ROADMAP.md:81`). |
| **Contact (marketing)** | ✅ Bulk import + subscribe toggle — `importContacts`/`setContactSubscribed` `campaigns.ts:184,263` | `contacts` | ❌ **No public unsubscribe page** | ❌ | ROADMAP `:189` flags this as legally required. `/order/{token}` is the pattern to copy. |
| **Check-in list** | ✅ Create `check-in/actions.ts:246,262`; door list lazily seeded `checkin.ts:118` | `checkInLists` | ❌ | ⚠️ App reads only the fixed `event-door` path (`badge.ts:391-395`, `DOOR_CHECK_IN_LIST_ID`) | A second list created in the dashboard is invisible to the badge. |
| **Check-in** | ✅ Create + delete — `submitScanAction` :150, `checkInByIdAction` :324, `undoCheckInAction` :387 | `checkInLists/{}/checkIns` | ❌ | ✅ Badge reflects it live `useCheckInStatus` `badge.ts:384` | **The one verified end-to-end loop** (AGENTS.md "Built end to end"). Confirmed in code. |
| **Check-in station** | ✅ Upsert — `touchStation` `checkin.ts:313,318,320` | `checkInStations` | ❌ | ❌ | Dashboard-internal. Fine. |
| **Scan event** | ✅ Create only, idempotent id — `check-in/actions.ts:210`, `scanEventIdFor()` | `scanEvents` | ❌ | ❌ | Dashboard-internal. Fine. |
| **Badge (printed)** | ❌ `badgeTemplates` / `badgePrintJobs` appear **0×** in `apps/organizer/src`; `badges.ts:71,119` only renders a QR from the registration | `badgeTemplates`, `badgePrintJobs` | ❌ | ⚠️ Digital badge only, `me/badge.tsx` | Modelled, never written, never read. ROADMAP `:180` calls this the highest-value unbuilt pair. |
| **Poll** | ⚠️ Enable only — `setQaSettingsAction` writes `sessions.pollsEnabled` (`session-qanda-manager/actions.ts:31`). **No poll writer**; `polls.ts:75` is read-only. | `sessions/{}/polls` | ❌ | ✅ `SessionPoll` `session-poll.tsx:22` | Organizer can turn on a feature they cannot then use. `tallies`/`totalVotes` frozen. |
| **Poll vote** | ❌ Read-only (`polls.ts:102`) | `sessions/{}/polls/{}/votes` | ❌ | ✅ `useCastVote` `qa.ts:235` | Votes land correctly; the tally that renders them does not. |
| **Q&A question** | ✅ Moderate — `moderateQuestionAction` `session-qanda-manager/actions.ts:47,63` (approve/hide/answer) | `sessions/{}/questions` | ❌ | ✅ `SessionQA`; attendees ask via `useAskQuestion` `qa.ts:76` (`state:'pending'`) | **The moderation loop is complete and correct** — ask → approve → appear (`qa.ts:56` filters `['approved','answered']`). Only the ranking is broken (frozen `upvoteCount`). |
| **Q&A upvote** | ❌ Never touched | `.../questions/{}/upvotes` | ❌ | ✅ `useToggleUpvote` `qa.ts:158` | Write succeeds, counter frozen, sort key dead. |
| **Q&A board** | ❌ Never touched | `sessions/{}/qaBoard/current` | ❌ | ❌ | Modelled + a trigger written; nothing writes it in production and nothing reads it. |
| **Survey** | ✅ Create + edit + status — `saveSurveyAction`/`setSurveyStatusAction` `engagement/survey-actions.ts:69,154` | `surveys` | ❌ | ❌ **Home tile routes to `coming-soon`** (`home/index.tsx:519-526`) | Authorable and unreachable. The tile's own copy says surveys wait on "the organizer console" — the console is ready and the app is not. |
| **Survey response** | ❌ Read-only aggregation (`surveys.ts:150`) | `surveys/{}/responses` | ❌ | ❌ | Seeded only (`scripts/src` ×1). Nothing can answer a survey. |
| **Notification / push token** | ❌ Read-only (`push.ts:184`); `notifications` never touched | `users/{}/notifications`, `users/{}/fcmTokens` | ❌ | ❌ — app states it plainly (`messages/index.tsx:201`) | Nothing writes `fcmTokens` (`push.ts:228` says so in the UI). Two triggers would write `notifications`; undeployed; no reader either way. |
| **Photo / image / any upload** | ❌ Nothing writes Storage anywhere in the repo; `images.ts:106` only *censuses* URLs | — (`storage.rules`, no writer) | ❌ | ❌ Home tile → `coming-soon` (`home/index.tsx:511-518`) | ROADMAP blocker 3. `storage.rules` is not even deployed (`deploy-rules.mjs` publishes `cloud.firestore` only, `ROADMAP.md:310`). |
| **Gathering (round table / meeting)** | ✅ Full — `saveGathering`/`placeAttendee`/`setGatheringStatus` `gatherings.ts:97,197,253` | `gatherings` | ❌ | ❌ | Authored, seated, shown to nobody. The screens say it is a plan not a feature (`ROADMAP.md:88`) — that is a decision, but it is still an unreached surface. |
| **Task / project** | ✅ Create + edit + advance — `saveTaskAction`/`advanceTaskAction` `projects-and-checklists/actions.ts:69,183` | `tasks` | ❌ | ❌ | Correctly internal. Assignees are never told (`message-team-members/page.tsx:133`). |
| **Document (event handouts)** | ❌ Read-only (`planning.ts:229,236`) | `documents` | ❌ | ❌ Home tile → `coming-soon` | Seeded only. Also distinct from `sessions/{}/materials`, which nothing writes or reads. |
| **Session material** | ❌ Never touched | `sessions/{}/materials` | ❌ | ❌ | Modelled (`models.ts:408`), zero writers, zero readers. |
| **Sponsor lead** | ❌ Never touched | `sponsors/{}/leads` | ❌ | ❌ | Modelled (`models.ts:648`); the exhibitor sales page promises it (`tickets/exhibitor/page.tsx:44`). **The website sells a capability that does not exist.** |
| **Entitlement** | ❌ Never touched | `users/{}/entitlements` | ❌ | ❌ | Modelled only. |
| **Settings (branding, access, logistics)** | ✅ Upsert — `saveSettings` `settings.ts:80,89`, 3 of 6 declared keys | `settings` | ❌ **Never read** | ❌ **Never read** | See B4. `event-website`, `registration`, `app-adoption` (`settings.ts:29-32`) are declared and never written *or* read. |
| **Email log** | ✅ Append-only via `@kgc/scripts` (`scripts/src/lib/email.ts:93`), from `messaging/actions.ts:63` and `email-campaign/actions.ts:66`; read back at `messaging.ts:208` | `emailLog` | ✅ written by the webhook path | ❌ | Correct as designed. No open/click tracking, no unsubscribe. |
| **Audit log** | ✅ Append-only `audit.ts:135`; read `data.ts:471` | `auditLog` | ❌ | ❌ | Correct. Identity is only the address typed beside the shared passphrase (`auth.ts`). |
| **Discount code** | ✅ Create + activate — **Stripe, not Firestore** `discount-codes.ts:136,167` | *(none)* | ⚠️ Redeemed via `allow_promotion_codes: true` on Checkout | ❌ | Deliberate (`discount-codes.ts:8-20`). Not a Firestore gap. |
| **Blog post** | ❌ No collection, no screen | *(none)* — `apps/web/src/lib/posts.ts:55` | ✅ `/blog`, `/blog/{slug}` | ❌ | 1,222 lines of content behind a redeploy. |
| **Prose page (CoC, CFP, team, about, …)** | ❌ No collection, no screen | *(none)* | ✅ 13 pages (§1c) | ❌ | ROADMAP Phase 5 `:212`. |
| **Site chrome (banner, ticker, nav, stats)** | ❌ | *(none)* — `apps/web/src/lib/site.ts:62,76,95,110,125,152` | ✅ every page | ❌ | Not on the ROADMAP at all. §1d. |

---

## 4. Broken links

Every place a dashboard edit does not reach the surface it should, ordered by
how visible the failure is.

### B1 — The programme is read-only everywhere. 🔴

`speakers`, `sponsors`, `tracks`, `rooms` have **no writer in any surface**.
Verified by grepping every `.set(`/`.update(`/`.add(`/`.delete()` site in
`apps/organizer/src`: the only hits on these four collections are reads
(`apps/organizer/src/lib/data.ts:152,191,250`, `:91`, `conflicts.ts:57-58`,
`cohorts.ts:68`, `webpages.ts:65-66`, `messaging.ts:110,155`,
`images.ts:111-112`). `apps/organizer/src/lib/csv-import.ts` defines only
`ATTENDEE_FIELDS` (:253) and `CONTACT_FIELDS` (:287) — the "generic importer"
that `ROADMAP.md:70` says closed blocker 4 cannot import a speaker.

Consequence: a speaker's name, photo, bio or company can only be changed by
editing Firestore directly or re-running `npm run seed`. The same is true of
every sponsor logo on the public `/sponsor` page.

### B2 — The dashboard reports readiness for a page that ignores the data. 🔴

`apps/organizer/src/lib/webpages.ts:95-107` computes readiness for a page at
`path: '/speakers'` — counting speakers with no photo, no bio, no company.
`apps/web/src/app/speakers/page.tsx:2` renders `SPEAKERS_2026` from
`apps/web/src/lib/speakers-2026.ts:108` and never calls `listSpeakers()`
(`apps/web/src/lib/data.ts:80` exists and has no caller in `apps/web/src/app`).

So the dashboard tells an organizer "11 speakers have no photo on your speakers
page" about a page that does not render those speakers. The ROADMAP defends the
hardcoding as deliberate (`:203-206`) and the page's docblock agrees
(`speakers/page.tsx:29-32`) — but the readiness screen was not told, and it is
the screen an organizer would trust.

### B3 — The dashboard's announcements never reach the website. 🟠

`sendAnnouncementAction` (`apps/organizer/src/app/(dash)/engagement/announcements/actions.ts:35,75`)
writes `announcements`. The app reads it three ways
(`app/src/lib/data/announcements.ts:20`). The website's banner and ticker are
`ANNOUNCEMENT` and `TICKER` constants at `apps/web/src/lib/site.ts:62,76`. An
organizer who posts "Room change: keynote moved to Bloomberg 165" reaches every
phone and no browser.

### B4 — `settings` is authored and read by nobody outside the dashboard. 🟠

`saveSettings` (`apps/organizer/src/lib/settings.ts:80,89`) is reached from six
routes, three of which are branding: `content/branding-center/app-branding`,
`content/branding-center/branded-event-url`, `attendees/admin-settings`. The
model's own docblock (`packages/shared/src/models.ts:1010-1011`) says settings
are *"authored by organizers through the console and read by the app or the
public website"*. Grep: `COLLECTIONS.settings` appears **zero times** in
`app/src` and **zero times** in `apps/web/src`. Nothing an organizer sets in the
Branding Center changes any colour, logo, or URL on either surface.

Worse, three of the six declared keys (`settings.ts:29,30,32` —
`event-website`, `registration`, `app-adoption`) are never written *or* read by
anything.

### B5 — Nine authorable entities have no surface. 🟠

`exhibitors`, `booths`, `gatherings`, `contacts`, `surveys`, `tasks`,
`documents`, `checkInStations`, and `settings` are all writable from the
dashboard and displayed on neither the app nor the website. Two of these are
deliberate and internal (`tasks`, `checkInStations`). Three are business-facing
and the absence is expensive:

- **`surveys`** — fully authorable (`engagement/survey-actions.ts:69,154`) and
  the app's Surveys tile routes to `coming-soon` with copy saying surveys wait
  on "the organizer console" (`app/src/app/(tabs)/home/index.tsx:519-526`). The
  console is done; the copy is stale.
- **`exhibitors` + `booths`** — authorable, and `/tickets/exhibitor` sells them
  ("A listing attendees can find … your booth number in the app every attendee
  already has open", `apps/web/src/app/tickets/exhibitor/page.tsx:47`). No such
  listing exists on either surface.
- **`gatherings`** — full seating machinery (`gatherings.ts:197`), no attendee
  can see which table they were placed at.

### B6 — Four app features write into a void. 🟠

An attendee taps and the write succeeds; the number never changes.

| Tap | Writes | Renders | Frozen because |
|---|---|---|---|
| Upvote a question | `.../questions/{}/upvotes/{uid}` `qa.ts:158` | `upvoteCount` `session-qa.tsx:151` — **and the sort order** `qa.ts:63-65` | `on-question-upvote-write.ts` undeployed |
| Vote in a poll | `.../polls/{}/votes/{uid}` `qa.ts:235` | `tallies` `session-poll.tsx:80`, `totalVotes` :52 | `tally-poll.ts` undeployed |
| React to a post | `.../reactions/{uid}` `community.ts:237` | `reactionCount` | `on-reaction-write.ts` undeployed |
| Reply to a post | `.../replies` `community.ts:219` | `replyCount` — **worked around** by `useReplyCounts` `community.ts:115` | `on-reply-write.ts` undeployed |

The reply case shows the fix pattern is known and cheap; it was applied once and
not to the other three. The dashboard applies the same fix to polls
(`apps/organizer/src/lib/polls.ts:17-27` counts vote documents) and the app does
not, so **organizer and attendee see different poll results on the same screen
during the same session.**

### B7 — Organizers cannot see or answer a direct message. 🟡

`threads` appears **0 times** in `apps/organizer/src`. The attendee app has a
full inbox with an unread badge (`app/src/app/messages/index.tsx:20`). There is
no moderation path and no organizer-to-attendee in-app message. Every dashboard
"message X" screen is email (`emailLog`, written indirectly by `scripts/src/lib/email.ts:93` from `apps/organizer/src/app/(dash)/messaging/actions.ts:63`).

### B8 — Two silent-failure modes that make a broken deployment look healthy. 🔴

1. **The dashboard falls back to an in-memory fake Firestore.**
   `apps/organizer/src/lib/firestore.ts:33` returns `demoFirestore()` whenever
   there is no `FIRESTORE_EMULATOR_HOST` *and* no credential
   (`apps/organizer/src/lib/demo/store.ts:282-285`). Every writer above then
   "succeeds" against process memory that Netlify recycles without warning
   (`store.ts:28-33`). It is surfaced in the UI, which is the right call — but
   it means "dashboard edit did not reach the app" and "dashboard is
   misconfigured" are the same symptom. This is the highest-severity
   *operational* linkage risk in the project.
2. **Composite-index failures render as empty states.** AGENTS.md warns that the
   emulator does not enforce indexes and that "two screens shipped broken this
   way and nobody noticed, because the hooks render an empty state on error".
   `app/src/lib/data/use-collection.ts:70` is the mitigation and it is used
   everywhere, but the app's own `useSessions` sorts client-side precisely to
   avoid needing an index (`sessions.ts:36-37`) — the discipline is real and
   undocumented anywhere a new query would be written.

### B9 — Stale claims in the docs that would mislead a build plan. 🟡

| Doc | Says | Code says |
|---|---|---|
| `ROADMAP.md:48,143,207,293` | 5 of 21 website pages read Firestore | **8 of 21** (§1) |
| `ROADMAP.md:15,59-61` + `apps/organizer/README.md` | "173 of 173 screens read real data" | 177 `page.tsx`; 173 map to `nav.ts` `IMPLEMENTED`; **~41 of the 177 touch no Firestore at all** — they render prose, links and gap panels. "All 173 return 200" is true; "all 173 read real data" is not. |
| `packages/shared/src/models.ts:1010` | `settings` is "read by the app or the public website" | Read by neither (B4) |
| `app/src/app/(tabs)/home/index.tsx:521-525` | Surveys wait on "the organizer console" being able to author them | The console authors them (`survey-actions.ts:69`) |
| `app/src/components/session-qa.tsx:24` | "The upvote count … does not move the instant you tap" | It never moves, and it is the sort key |

### B10 — Website capabilities the site sells and nothing delivers. 🟡

- `apps/web/src/app/tickets/exhibitor/page.tsx:43` — "Scan an attendee badge
  from the KGC app and the contact lands in your exhibitor portal." No scanner
  in the app, no `leads` writer, no portal.
- `apps/web/src/app/tickets/exhibitor/page.tsx:47` — "Your profile, materials
  and booth number in the app." `exhibitors` and `booths` are dashboard-only;
  `materials` has no writer or reader.
- `apps/web/src/lib/site.ts:76` `TICKER` — "Every session recorded". No
  recording, streaming or artifact surface exists (ROADMAP blocker 5).

### B11 — Ancillary

- **No public unsubscribe.** `contacts.subscribed` is toggled from the dashboard
  (`campaigns.ts:263`); no public route flips it. `ROADMAP.md:189` flags this as
  legally required before a bulk campaign.
- **A second check-in list is invisible to the badge.** `createListAction`
  (`check-in/actions.ts:246`) can make one; `app/src/lib/data/badge.ts:391-395`
  reads only `DOOR_CHECK_IN_LIST_ID`.
- **Session editing cannot assign a speaker.** `saveSessionAction`'s patch
  (`session-manager/[id]/actions.ts:98-110`) covers title, description, room,
  status and times. `speakerIds` and the denormalised `speakerNames` are
  explicitly left to "the importer" (:50-52) — an importer that has no speaker
  fields.
- **`apps/web` has no README**, contrary to the audit brief's assumption. The
  site's operating knowledge lives in docblocks (`site.ts`, `firestore.ts:6-25`,
  `speakers/page.tsx:11-38`) and in `apps/web/netlify.toml`.
- **`qaBoard`, `notifications`, `materials`, `leads`, `entitlements`,
  `badgeTemplates`, `badgePrintJobs`, `savedContacts` (organizer side),
  `pendingAnswers` (organizer side)** — modelled in `@kgc/shared`, written by
  nothing that ships, read by nothing that ships.

---

## 5. Prioritised TODO — making the three surfaces correspond

Ordered by (visibility of the failure) × (cost to close). Each item names the
file that changes.

### P0 — the dashboard cannot edit the programme it publishes

1. **Speaker CRUD.** New `apps/organizer/src/app/(dash)/content/speaker-center/speaker-manager/actions.ts`
   with `saveSpeakerAction` / `setSpeakerStatusAction`, mirroring
   `exhibitor-manager/actions.ts:32,125` exactly — that file is the template
   (set-with-merge, audit entry, `revalidatePath`). Add `SPEAKER_FIELDS` to
   `apps/organizer/src/lib/csv-import.ts` beside `ATTENDEE_FIELDS:253`.
   *Unblocks: `/speakers`, People→Speakers, Speaker detail, B1, B2.*
2. **Sponsor CRUD.** Same pattern, `content/sponsor-center/sponsor-manager`.
   *Unblocks `/sponsor` and `/` — two public pages.*
3. **Session create + speaker assignment.** Extend
   `session-manager/[id]/actions.ts:98` to write `speakerIds` and re-derive
   `speakerNames`; add a `createSessionAction` on
   `session-manager/page.tsx`. Keep the single-`update()` discipline documented
   at :30-38.
4. **Track and room CRUD.** Two small screens; `rooms` unblocks a room rename
   reaching every phone (the demo's own claim, `session-manager/[id]/actions.ts:26-28`).

### P1 — deploy the eight triggers

5. **Blaze + `firebase deploy --only functions`** (or the `scripts/ops` route,
   since the CLI is refused per `ROADMAP.md:37`). This alone fixes B6 rows 1–3,
   the Q&A sort order, and starts `notifications`.
6. **Until then, make the app subtract like the dashboard does.** Port
   `apps/organizer/src/lib/polls.ts:17-27`'s reasoning into
   `app/src/lib/data/qa.ts`: count `votes` and `upvotes` documents rather than
   reading `tallies`/`upvoteCount`, the same way
   `app/src/lib/data/community.ts:115` already handles `replyCount`. Cheap, and
   it removes the case where organizer and attendee see different poll numbers
   on the same stage.

### P2 — connect the surfaces that already have data

7. **Website reads `announcements`.** Replace `SITE.ANNOUNCEMENT`
   (`apps/web/src/lib/site.ts:62`) with a `listAnnouncements()` call in
   `apps/web/src/lib/data.ts`, rendered by `apps/web/src/components/ticker.tsx`
   and the header. One function, one page already `force-dynamic`. Closes B3.
8. **App reads `surveys`.** Replace the `coming-soon` tile at
   `app/src/app/(tabs)/home/index.tsx:519-526` with a survey list + a
   `surveys/{}/responses` writer. The authoring half is finished.
9. **Website reads `settings`.** Have `apps/web/src/lib/site.ts` fall back to
   `settings/event-website` and `settings/branding` for `ANNOUNCEMENT`,
   `HCLS_BADGE`, `ATTENDEES_EXPECTED`, `APP_DISTRIBUTION`, `APP_URL`. Closes B4
   for the website; do the app half with `settings/branding` next.
10. **Exhibitor + booth surfaces.** An `/exhibitors` page on the website
    (ROADMAP `:211` already lists it) and an app screen behind People. Both
    collections are already authorable.

### P3 — the CMS, which is Phase 5

11. **One `pages/{slug}` collection** (`title`, `blocks[]`, `status`,
    `updatedBy`) plus one dashboard screen under
    `marketing/event-webpages`. Migrate the 13 static pages in §1c in order of
    edit frequency: code of conduct → CFP/call-for-posters → team → about → the
    rest. `apps/organizer/src/lib/webpages.ts` already owns the "what is
    published, is it ready, here is the link" framing — extend it rather than
    building a WYSIWYG (its docblock at :16-27 argues this well).
12. **A `posts` collection for the blog**, same screen family.
13. **Public unsubscribe route** at `/u/{token}`, reusing
    `apps/web/src/lib/order-token.ts`'s HMAC pattern. Small, and
    `ROADMAP.md:189` says it gates the first bulk campaign legally.

### P4 — close the modelled-but-dead set

14. **Organizer↔attendee messaging**, or delete `threads` from the dashboard's
    remit explicitly. Today it is neither built nor acknowledged.
15. **File upload** (ROADMAP blocker 3) — and note `storage.rules` is still not
    deployed: `scripts/ops/deploy-rules.mjs` publishes `cloud.firestore` only
    (`ROADMAP.md:310`). Unblocks speaker photos, sponsor logos, `materials`,
    `documents`, photos.
16. **Badge templates + print jobs**, `sessions/{}/materials`,
    `sponsors/{}/leads`, `users/{}/entitlements` — decide per entity whether to
    build the writer or remove the model. Each one currently reads as a promise.

### P5 — operational

17. **Fail loud instead of falling back.** Gate
    `apps/organizer/src/lib/firestore.ts:33` behind an explicit
    `DASHBOARD_FIXTURE_MODE=1` rather than inferring it from missing
    credentials, so a Netlify deploy that lost its `FIREBASE_SERVICE_ACCOUNT`
    throws instead of quietly serving fixture data that accepts writes. Closes
    B8.1 — the failure mode most likely to make "the dashboard doesn't reach the
    app" true without anyone noticing.
18. **Correct the four stale doc claims** in B9 — in particular
    `ROADMAP.md:48,143,207,293` (5 → 8 pages) and
    `packages/shared/src/models.ts:1010` (settings is read by nobody), since
    both would send a future build in the wrong direction.
