# Cloud Functions — Spec

Written 2026-08-26, the Phase 0 deliverable from `BACKEND-ROADMAP.md`. This
file replaces the missing `DECISIONS.md` for everything Cloud-Functions
shaped: exact name, trigger, what each function writes, and what it must
never do. Nobody codes a function listed here without its row in this table
being current — and if the implementation ever drifts from what's written
here, this file gets corrected, not the other way around.

Every function is developed and tested against the emulator (Phase 1) before
any deployment — nothing here needs Blaze to be written or tested.

---

## Table

| # | Function | Type | Trigger | Event | Writes | Must NOT do |
|---|----------|------|---------|-------|--------|-------------|
| 1 | `onReplyWrite` | Firestore trigger | `communityPosts/{postId}/replies/{replyId}` | `onWrite` | `communityPosts/{postId}.replyCount`: +1 if the doc appears, -1 if it disappears | Must not decrement on a `status` change (hidden/removed) — hiding a reply must not orphan the counter; only a real `delete` (author retraction or hard moderation) changes the count. |
| 2 | `onReactionWrite` | Firestore trigger | `communityPosts/{postId}/reactions/{uid}` | `onWrite` | `communityPosts/{postId}.reactionCount`: +1/-1 on appearance/disappearance | Must do nothing on an `update` (emoji change, same uid). |
| 3 | `onQuestionUpvoteWrite` | Firestore trigger | `sessions/{sessionId}/questions/{questionId}/upvotes/{uid}` | `onWrite` | `.../questions/{questionId}.upvoteCount`: +1/-1 | N/A — the rules only allow `create`/`delete` on this path. |
| 4 | `tallyPoll` | Debounced via Cloud Tasks (~5s), kicked off by a Firestore trigger | `sessions/{sessionId}/polls/{pollId}/votes/{uid}` | `onWrite` → schedules a deferred recompute if one isn't already pending | `.../polls/{pollId}.tallies`, `.totalVotes`, `.talliesUpdatedAt` — **fully recomputed** from the `votes` subcollection, never incremented | Never read/write `tallies` by +1/-1 — that is exactly the bug the move to a subcollection was meant to avoid (16m40s to drain 1000 votes). Cloud Scheduler has a 1-minute floor, incompatible with the model's "at most once every 5s" — hence Cloud Tasks rather than a classic scheduled job. |
| 5 | `rebuildQaBoard` | Debounced (same mechanism as #4) | `sessions/{sessionId}/questions/{questionId}` | `onWrite` (a `state` or `upvoteCount` change) | `sessions/{sessionId}/qaBoard/current`: `questions[]` **filtered strictly to `state == 'approved'`**, sorted by `upvoteCount` desc, capped at N (to be fixed in Phase 1, e.g. 50); `rebuiltAt` | Never write a `pending`, unapproved-`answered`, or `hidden` question into this document — it's the public document projected on screen, so no unmoderated content ever enters it. |
| 6 | `mirrorDirectory` | Firestore trigger | `users/{uid}` | `onWrite` | `directory/{uid}`: created/updated if `visibleInDirectory == true`, **deleted** otherwise | Never copy `email`; never copy `photoURL` without validation (already forbidden client-side by `validDirectoryEntry()` — the function must stay consistent with that contract). The existing client write path on `directory/{uid}` **stays open** as a fallback — dual-write assumed for Phase 1, no change to `firestore.rules`. |
| 7 | `onAnnouncementCreate` | Firestore trigger | `announcements/{id}` | `onCreate` | `users/{uid}/notifications/{id}` (type `announcement`) for every attendee with `notificationPrefs.announcements == true`. **No FCM** — the dashboard sends the announcement push (decision 11) | Must not notify unregistered accounts. Batch the writes (Firestore's 500-op/batch limit, so ~2 batches for 1000 users). **Must never send FCM**: `announcementPush()` in `apps/organizer/src/lib/push.ts` is the sole sender, and two senders means two notifications per device. |
| 8 | `onSessionAgendaChange` | Firestore trigger | `sessions/{sessionId}` | `onUpdate`, filtered to `status == 'published'` and a change to `roomId` / `startsAtLocal` / `endsAtLocal` / `day` / `status → cancelled`, then through the debounce and the fan-out breaker (decisions 12-13) | `users/{uid}/notifications/{id}` (type `agenda-change`) for every attendee with this `sessionId` in `savedSessions` (collection group query) + FCM push to those of them who have not set `notificationPrefs.sessionReminders == false`. **Sole owner of the room/time-change push** (decision 11) | Must not fire on a cosmetic change (`description`, `slidesUrl`, a cached `speakerNames`) — only fields that change where/when/whether the session happens. **The in-app notification is written unconditionally**: there is no dedicated preference in `notificationPrefs` for this type, and there won't be — decision made, no new checkbox. The *push* half honours the existing `sessionReminders` switch (decision 11). |
| 9 | `requestOtp` | HTTPS callable (no Firestore trigger) | — | client call (email) | `otpCodes/{id}`: 6-digit code, `expiresAt` = +10 min, `attempts: 0`; `rateLimits/{id}`: throttle **5 requests per email per hour**; `rateLimits/ip_requestOtp_{hash}`: **120 requests per caller IP per 15 minutes** (decision 14) | Must never return a different response depending on whether the email matches a ticket (same anti-enumeration logic as `registrationIsMine`) — the per-IP refusal returns the same code and message as the per-email one, so neither limit is distinguishable from the other. Delivers the code by email through `@kgc/scripts/src/lib/email.ts` (`sendSignInCode`), the same sender the Stripe webhook and the dashboard use. Delivery sits **after** the transaction commits — a retried transaction would otherwise mail a fresh code per attempt — and a failed or skipped send never changes the response and never refunds the rate-limit tick. **Must never log the code.** With no `RESEND_API_KEY` the send degrades to an `emailLog` row with `status: 'skipped'`; the response is `{ ok: true }` either way. |
| 10 | `verifyOtp` | HTTPS callable | — | client call (email + code) | Checks `registrations` (primary `email` or `altEmails`) for an **active** ticket, refusing outright if none exists; Auth account (find-or-create by email); custom claims `{ registered: true, roles: ['attendee'], eventId }` **minted only when the account is newly created**; returns a custom token; a per-caller-IP limit of **120 calls per 15 minutes** consumed before the code is even read (decision 14); increments `attempts` on `otpCodes` on a wrong guess, deletes the document (refusing immediately) on expiry (10 min) **or once 5 wrong guesses have already been made** — the 6th call is dead even if it finally submits the right code | Must **not** create `users/{uid}` — that stays the client's job on first sign-in (a known Phase 2 gap). **`roles` is always `['attendee']`** on first sign-in, never derived from a `speakers`/allowlist lookup — special roles (`organizer`, `speaker`, `reviewer`, `exhibitor`, `checkin`) stay manually granted via `npm run claims`. Must **never** touch an existing account's custom claims on a *returning* sign-in — a hand-granted role must survive every future sign-in, not just the session it was granted in. |

| 11 | `mirrorExhibitorListing` | Firestore trigger | `exhibitors/{exhibitorId}` | `onWrite` | `exhibitorListings/{exhibitorId}`: created/updated **only** if `status == 'confirmed'`, **deleted** on every other status and on the exhibitor's own deletion. Projects exactly six fields — `eventId`, `exhibitorId`, `name`, `boothNumber?`, `logoURL?`, `description?`, `website?` | Must **never** copy `contactName`, `contactEmail`, `passesAllocated`, `passesUsed` or `status` — those are the four reasons the projection exists, and `ExhibitorListingDoc` deliberately carries no `status` field to filter on. Must never *filter* a non-confirmed exhibitor; it must **delete** the document, so the record never leaves the server — the same guarantee opting out of `directory` gets. Must never publish `ExhibitorDoc.boothNumber` (see #12). `logoURL` passes only if it is a `firebasestorage.googleapis.com` URL and `website` only if it parses as `http(s)` — a projection fetched by a thousand devices is a beacon otherwise. Must never write `exhibitors` — that is the loop. |
| 12 | `onBoothAssignmentWrite` | Firestore trigger | `booths/{boothId}` | `onWrite`, filtered to a change in `exhibitorId` / `status` / `number` | Re-runs the #11 projection for the booth's occupant **before and after** the write (at most two exhibitors), so an allocation made on the floor plan alone reaches the app | Must not fire on a cosmetic booth edit (`note`, `zone`, `size`, `ticketTypeId`) — nothing an attendee can see changed. Must **never** write `booths` (self-feeding loop) or `exhibitors`. Only `status == 'assigned'` yields a number: `held` is a space promised and unpaid, and publishing it is the same failure as publishing a `provisional` exhibitor. |

**Out of scope for Phase 1** (an explicit decision, not an oversight):
`sendSessionReminders` (a scheduled reminder before a saved session) and the
`type: "message"` notification on `onMessageCreate`. The `unread` counter on
threads stays client-managed, as today — nothing changes there.

---

## Decisions made in Phase 0

1. **`tallies`/`qaBoard` aggregation**: a full recompute, debounced to ~5s via
   Cloud Tasks (not Cloud Scheduler — its 1-minute floor is incompatible), no
   real-time increment on every vote/upvote.
2. **`directory`**: dual-write kept — `mirrorDirectory` becomes the source of
   truth, but the existing client write path (the shim documented in
   `firestore.rules`) stays open as a fallback. No change to the rules or the
   134-test suite for now.
3. **`verifyOtp`/`requestOtp`**: both are in scope for Phase 1. ⚠️ **Superseded
   2026-08-31 (BUILD-PLAN 1.2).** This decision originally read "no real email
   is sent until a provider is chosen (Phase 5) — the code is logged to the
   console on the emulator", and that stopped being tenable the moment removing
   demo mode made OTP the only way a real purchaser gets an account: a sign-in
   code in a Cloud Functions log is readable by anyone with Logs Viewer and
   reaches no attendee. `requestOtp` now sends through Resend via the shared
   sender, and prints nothing. On a deployment with no `RESEND_API_KEY` it
   degrades to an `emailLog` skip rather than falling back to the console.
4. **Push for Phase 1**: only `onAnnouncementCreate` and
   `onSessionAgendaChange`. The scheduled reminder and the message
   notification are deferred.
5. **`onSessionAgendaChange` has no dedicated preference**: it notifies every
   affected attendee unconditionally, no new field in `notificationPrefs`.
6. **Roles on first sign-in**: always `['attendee']` by default, never
   auto-derived. Special roles go through `npm run claims` (manual), the same
   as for seeded accounts today. Refined during `verifyOtp`'s own build: this
   default is gated on an **active ticket in `registrations`** — `verifyOtp`
   is the only place that check happens, since `requestOtp` deliberately
   never looks at `registrations` (anti-enumeration) — and it applies only to
   a **newly created** Auth account. A returning account's claims are never
   rewritten, so a role granted by hand survives every sign-in after the one
   it was granted in.
7. **`qaBoard/current`**: a strict filter on `state == 'approved'` before
   writing. No unmoderated content in the public document.
8. **Missing index**: added in this same phase — `firestore.indexes.json`
   now has a `savedSessions.sessionId` override with `COLLECTION_GROUP`
   scope, needed so `onSessionAgendaChange` (#8) can find every attendee who
   saved a given session, across all users.
9. **`requestOtp` thresholds**: 5 requests per email per hour; a code is
   valid for 10 minutes. The TTL is passed to the email template rather than
   restated in it, so the number an attendee reads cannot drift from the one
   `verifyOtp` enforces.
10. **`verifyOtp` brute-force cap**: 5 wrong guesses tolerated per code:
    `otpCodes/{id}.attempts` increments on each one, and the call after the
    fifth — regardless of what code it submits — finds `attempts` already at
    the cap and invalidates the document outright. This is checked before
    comparing the submitted code, so a code cannot be redeemed by guessing
    right on the 6th call.

## Decisions made hardening for deployment (BUILD-PLAN tasks 0.3 / 0.4)

These were taken on 2026-08-30, before anything was deployed, from audit
`docs/audit-2026-08-30/F-blaze-infra.md`. Nothing here changes what a function
computes; all of it changes what a function is allowed to cost.

11. **★ One sender per notification. Announcements are the dashboard's; agenda
    changes are the trigger's.** Both halves existed and neither was live, so
    the duplicate was invisible: `apps/organizer/src/lib/push.ts` already sent
    for announcements and room changes, and `onAnnouncementCreate` /
    `onSessionAgendaChange` would have sent again the moment they deployed and
    `fcmTokens` got a writer — two notifications on every device, discovered
    during the conference.

    - **Announcements → the dashboard.** `announcementPush()` publishes one FCM
      message to the event topic and the per-user
      `notificationPrefs.announcements` switch is honoured at *subscribe* time,
      so one call reaches every opted-in device. The trigger's version gathered
      every recipient's `fcmTokens` subcollection — a read per attendee — and
      then sent N multicasts for the same message. The FCM branch has been
      removed from `on-announcement-create.ts`; it still writes the in-app
      notification documents, which the dashboard cannot.
      **Known cost of this choice:** an announcement created outside the
      dashboard (a script, the console) writes inboxes and sends no push.
      Accepted — the dashboard is the only thing that creates announcements
      today, and a missing push is recoverable in a way that a duplicate push
      to a thousand phones during a keynote is not.
    - **Agenda changes → the trigger.** It fires on any write to the session,
      including the CSV importer's and a script's, and a notification that
      depends on which UI made the change is a notification that goes missing.
      `roomChangePush()` still computes and reports the audience — useful on
      the screen — and no longer calls FCM.
    - The *push* half of `onSessionAgendaChange` now honours
      `notificationPrefs.sessionReminders`, which the dashboard path always
      did. Decision 5 is unchanged and unweakened: the in-app notification
      document is still written to every saver unconditionally, and there is
      still no new checkbox. What changed is that a switch that already exists,
      and that the dashboard already honoured for exactly this message, is no
      longer ignored by the server.

12. **`onSessionAgendaChange` is debounced after all**, reversing the Phase 1
    note below that recorded it as deliberately un-debounced. That note is
    still right about the *reason* — a single room change should not wait
    behind a queue — so the debounce is leading-edge: the first material change
    notifies immediately, and a later one inside a 2-minute window is dropped
    **only if its change-set says nothing the first one did not already say**.
    Room, then room again, is one notification. Room, then time, is two.
    Coalescing on elapsed time alone would silently swallow a second real fact,
    which is a worse failure than one extra notification. State lives in
    `rateLimits/agendaNotice_{sessionId}`.

13. **A fan-out circuit breaker on `onSessionAgendaChange`, and
    `maxInstances: 1` with `concurrency: 1`.** This is the trigger's real
    hazard, and the debounce does not touch it: a bulk agenda re-import changes
    hundreds of *different* sessions at once, which at KGC scale is ~100,000
    notification writes and ~100,000 real push notifications. The money is tens
    of cents; the pushes are not recoverable. So past 20 distinct sessions
    notified inside a rolling 10-minute window the fan-out stops and logs
    `console.error` — more than twenty material agenda changes in ten minutes
    is a bulk operation, and the right response to a bulk operation is one
    announcement, not one push per attendee per session. The window rolls, so
    the breaker resets itself; a latching breaker would silently stop notifying
    mid-conference and nobody would find out until the room change nobody
    heard about. Counter in `rateLimits/agendaNotice_fanout`. Serialising the
    function is what makes that counter exact and gives a human time to notice
    a runaway import.

14. **A per-IP limit on both public callables, alongside the per-email one.**
    The per-email cap is defeated by cycling addresses, which is the entire
    attack: every request is still an invocation and two writes. 120 requests
    per caller IP per 15 minutes, keyed on the **second-to-last**
    `X-Forwarded-For` entry — the one Google's front end appends and the client
    cannot forge — and stored under a hash of the address, so no raw IP is
    written to Firestore. The cap is deliberately generous because a conference
    venue is behind NAT and several hundred attendees share one address at the
    registration desk; a caller sitting at the cap all day costs a fraction of
    a cent, and a locked-out attendee costs a support conversation. Both
    limits refuse with the same code and message, so neither is distinguishable
    from the other and the anti-enumeration property in decision 3 survives.

15. **App Check is registered but NOT enforced, and that is a decision.** App
    Check is the right guard for these two endpoints — it is the one mechanism
    that proves a call came from a real build of the real app — but the
    attendee app runs in Expo Go, which cannot attest: App Attest and Play
    Integrity need native modules only a development build carries, and the JS
    SDK's reCAPTCHA providers need a browser DOM React Native does not have.
    Enforcing it today would return 401 to every real attendee while costing an
    attacker nothing. `enforceAppCheck: false` is therefore stated explicitly
    on both callables rather than left unset, so it reads as a dated decision
    rather than a missing option. Flip it the moment the development build
    lands — which push and image upload both need anyway. The runbook carries
    the step.

16. **Runtime options are per function, never `setGlobalOptions` in
    `index.ts`.** That file is nothing but re-exports, and ESM evaluates every
    imported module before the importing module's body runs, so all fourteen
    functions are already defined by the time any statement there executes. A
    `setGlobalOptions` call placed in it compiles, deploys, and caps nothing —
    you would ship believing instances were bounded. `functions/src/runtime-options.ts`
    holds the shared bundles and both that file and `index.ts` carry the
    warning. `minInstances: 0` is set **explicitly** even though it is the
    default: it is the one option that bills for doing nothing, and unset reads
    like an oversight to the next person trying to fix a cold start. Verify a
    deploy in the Cloud Run console, never by reading the source.

17. **TTL on everything the callables write.** `otpCodes` already carried
    `expiresAt`; `rateLimits` documents now carry one too, including the
    per-email counters. Both collections otherwise grow by one document per
    distinct email and per distinct IP, forever — for endpoints whose whole
    threat model is a caller generating distinct values. The field does nothing
    until the TTL policy is installed: `docs/deploy-functions.md` has the
    command, and it is a deploy step, not a code one. `RateLimitDoc` in
    `@kgc/shared` has not been widened for `expiresAt`; `request-otp.ts`
    declares the extra field locally instead, and widening the shared type
    belongs to whoever next edits that package.

18. **`exhibitorListings.boothNumber` is resolved from `booths`, never copied
    from `exhibitors`.** `ExhibitorDoc.boothNumber` is free text typed into a
    console form that validates nothing, and `assignBooth` in
    `apps/organizer/src/lib/booths.ts` writes it again as a best-effort
    denormalisation *outside* its transaction, inside its own `try/catch` — a
    failure there is logged and the flow carries on. Audit C found the resulting
    split-brain live in the seed: `Withdrawn Systems` claims `E06` while
    `booths/E06` is `available`. Decisive for this projection specifically:
    `assignBooth` writes that label on a **hold** as well as an assignment, and a
    `held` booth is an unpaid promise — the booth-level twin of the `provisional`
    status the whole projection exists to keep off the wire. So the number comes
    from a `booths` document whose `exhibitorId` matches **and** whose `status ==
    'assigned'`, which is the same authority rule `listExhibitorsByZone` in
    `apps/web/src/lib/data.ts` already applies independently.

    That is why #12 exists. Resolving from `booths` is only correct if a booth
    write re-projects, and it costs a second deployable unit — which is the
    honest trade against the alternative of publishing no number at all. Publish
    nothing was rejected because the app sorts the hall by booth number and it is
    the one field that makes a listing actionable to somebody standing in the
    aisle. The exhibitor may hold several assigned spaces; the lowest number is
    published, matching how `listExhibitorsByZone` files them under the first.

19. **The projection compares before it writes.** `publishExhibitorListing`
    reads the existing listing and returns without writing when every projected
    field already matches. Eventarc delivers at least once and #12 re-projects on
    every occupancy change, so the same payload arrives repeatedly as a matter of
    course. Beyond the saved write, this keeps `updatedAt` meaning "something an
    attendee can see changed" rather than "a redelivery happened". `createdAt` is
    carried forward from the stored document, so a `confirmed → cancelled →
    confirmed` round trip does not rewrite when the listing was first published.

## Phase 1 status

- `functions/package.json` and `functions/tsconfig.json` exist. The workspace
  is ESM, bundled with esbuild (`npm run build --workspace=functions`) rather
  than emitted by `tsc` — `@kgc/shared` has no build step and points at its
  `.ts` source, which the Cloud Functions Node runtime cannot load directly,
  so esbuild inlines it into `lib/index.js` at build time while leaving
  `firebase-admin`/`firebase-functions` external. `tsc --noEmit` is
  typecheck-only, the same split as `scripts/`.
- `firebase.json` has a `functions` block (source, codebase, ignore list) and
  a `functions` emulator on port 5001. `npm run dev:emulators` and
  `npm run test:functions` both include it.
- All twelve rows in the table (#1–#12) are built and tested against the emulator with
  seeded data — `tests/functions/`, run via `npm run test:functions`. Each
  Cloud Tasks queue is auto-detected and emulated by the Firebase CLI as soon
  as its `onTaskDispatched` function exists in the codebase — no extra
  emulator config was needed beyond what #1–#3 already required. Phase 1 is
  complete.
- `mirrorExhibitorListing` and `onBoothAssignmentWrite` (#11-#12) were added on
  2026-08-31 (FU-15). Until then `npm run seed` was the only writer of
  `exhibitorListings`, so the app's exhibitor hall was as fresh as the last seed
  locally and permanently empty on the live project. `tests/functions/mirrorExhibitorListing.test.ts`
  covers the five cases that matter: a `confirmed` exhibitor publishes, a
  `provisional` one publishes nothing, `confirmed → cancelled` **deletes**, the
  projection carries no contact details and no pass counts, and a replay writes
  nothing at all.
- `npm run test:functions` now starts the **Auth** emulator too
  (`--only firestore,auth,functions`, previously `firestore,functions`) —
  `verifyOtp` is the first function in this repo to call `firebase-admin/auth`,
  and without `FIREBASE_AUTH_EMULATOR_HOST` set, the Admin SDK would try to
  reach real Firebase Auth infrastructure with no credentials in this
  environment.
- `verifyOtp` lives at `functions/src/callable/verify-otp.ts`, alongside
  `request-otp.ts`. `normaliseEmail`/`otpDocId` moved out of `request-otp.ts`
  into a new `functions/src/lib/otp.ts` so both files import the identical
  id-derivation logic rather than keeping two copies that could drift apart —
  a real risk here, since both must land on the same `otpCodes/{id}` for the
  same email. `registrationId()`, by contrast, is duplicated rather than
  shared — see the docblock atop `verify-otp.ts` for why: it must match
  `scripts/src/lib/ids.ts`'s function of the same name exactly, and that one
  can't move into `@kgc/shared` because `@kgc/shared` is also bundled into
  the Expo app, which has no `node:crypto`.
- `findActiveRegistration()` in `verify-otp.ts` checks the primary `email`
  first (a direct `get()` on the derived id, no query) and falls back to an
  `array-contains` query on `altEmails`, filtering `status == 'active'` in
  memory rather than adding a second `where()` — an `array-contains` filter
  combined with an equality filter needs a composite index, and alt-email
  matches are rare enough that this isn't worth a new `firestore.indexes.json`
  entry for a query that will almost never run.
- `requestOtp` lives at `functions/src/callable/`, a new sibling to
  `triggers/` — it's an HTTPS callable, not a Firestore trigger, and the
  directory split mirrors that. Its id scheme (`sha256(normalised email)`,
  shared by `otpCodes/{id}` and `rateLimits/{id}`) is deliberately set up now
  so `verifyOtp` (#10) lands on the exact same `otpCodes` document a request
  wrote, without either function needing to query for it.
- `OtpCodeDoc` and `RateLimitDoc` were added to `packages/shared/src/models.ts`
  under a new "Auth — server-only" section, even though nothing outside
  Cloud Functions ever reads or writes them — `models.ts` is documented as
  covering every Firestore document shape, and the alternative (typing them
  only inside `functions/`) would leave `verifyOtp` unable to import the same
  interface `requestOtp` wrote against.
- `requestOtp` is the first caller of `@kgc/scripts/src/lib/email.ts` that does
  **not** run its Firestore handle with `ignoreUndefinedProperties`. Every
  `emailLog` write from that module therefore threw — into its own `catch`,
  which reports on stdout and continues by design — and the sender looked like
  it worked while logging nothing at all. Fixed in the module, by stripping
  `undefined` keys before the write, rather than by turning the setting on in
  `functions/`: that setting is store-wide and also makes a merge write unable
  to clear a field (AGENTS.md gotcha 9), and no shared module should require its
  callers to adopt a footgun to be usable.
- `tests/functions/requestOtp.test.ts` invokes the callable emulator's HTTP
  endpoint directly (`{data}` in, `{result}`/`{error}` out) rather than
  through a callable client SDK — this repo has no `firebase` client package
  as a dependency (only `@firebase/rules-unit-testing`, for the rules suite),
  and pulling one in to save one `fetch()` call didn't seem worth it. The
  helper lives in `tests/functions/lib/emulator.ts` as `callCallable()` so
  `verifyOtp`'s test can reuse it.
- `onAnnouncementCreate` treats "every doc in `users`" as "every registered
  attendee" rather than checking the `registered` custom claim directly —
  there is no queryable Firestore field for that claim, and checking it for
  ~1,000 users would mean ~1,000 Admin Auth lookups. A `users/{uid}` doc
  only exists once a real sign-in creates it, which only happens after the
  claim is minted, so the collection is a sound proxy. It writes the
  notification at the announcement's own document id, so a retried
  dispatch overwrites the same 1,000 documents rather than duplicating
  them. The FCM branch is written and typechecked but effectively
  untested: there is no Cloud Messaging emulator, this repo has no
  credentials to call real FCM from a test, and no code anywhere writes
  `fcmTokens` yet (a Known Gap in `AGENTS.md`) — so the only thing
  `tests/functions/onAnnouncementCreate.test.ts` proves about `push: true`
  is that the code path completes when the token list is empty, which is
  also the true state of the whole app today.
- `mirrorDirectory` bounds `name`/`title`/`company`/`interests` to the same
  limits `validDirectoryEntry()` enforces on the client write path, even
  though nothing enforces them on `users/{uid}` itself — the directory is
  ~1,000 documents fetched whole by every attendee, and bypassing rules
  must not mean bypassing that budget too. It also only ever mirrors
  `photoURL` when the value's hostname is `firebasestorage.googleapis.com`
  (and, as of `fix-photourl-validation`, scheme `https:` too) — a check that
  used to be the only thing standing between an arbitrary attacker string and
  1,000 attendees' screens. It no longer is: `firestore.rules` now enforces
  the identical constraint directly on `users/{uid}.photoURL` itself, and
  this check stays as defense in depth against any future Admin-SDK writer
  that bypasses rules entirely. `seed-demo.ts`'s directory write is confirmed
  to still be
  a genuine second writer, not a stale Spark-only fallback: this trigger
  now runs on the emulator like every other function here and recomputes
  the same document moments after seeding finishes.
- `onPollVoteWrite`'s and `onQuestionWrite`'s debounce is a deterministic,
  hashed, time-bucketed Cloud Tasks id (one 5s bucket per poll or session,
  used at most once ever) rather than a lock document — see the docblock on
  `on-poll-vote-write.ts` for why a *reused* fixed id would have gone
  silently stale after its first debounce window.
- `rebuildQaBoard` reads every question under a session and filters to
  `state == 'approved'` in memory rather than with an indexed query — a
  session's live Q&A runs a few dozen questions deep at most, well under
  what would justify adding another composite index for this.
- **`initializeApp()` sets an explicit `serviceAccountId` under
  `FUNCTIONS_EMULATOR`.** Without it, `getFunctions().taskQueue(...).enqueue()`
  resolves the service account email from the GCE metadata server on every
  call — instant on real Cloud Functions infrastructure, but in this
  environment that server is unreachable in a way that hangs rather than
  fails fast, which was observed to block a function for its full 60s
  timeout and starve every other trigger sharing the emulator's worker pool.
  See the docblock in `functions/src/index.ts`.
- **The local Cloud Tasks emulator does not honor `scheduleDelaySeconds`.**
  It dispatches a task within about a second regardless of what was
  requested, instead of genuinely waiting out the delay the way production
  Cloud Tasks does. `onPollVoteWrite`'s and `onQuestionWrite`'s bucketed
  debounce ids are only collision-safe *because* production really waits: a
  second event sharing a bucket is mathematically guaranteed to arrive before
  that bucket's task fires, since the task can't fire before
  (first-event-time + 5s) and the bucket has already closed by then. Under
  the emulator's fast dispatch that guarantee breaks — a bucket's task can
  fire and complete before a later event in the *same* bucket even exists,
  so that event's own `enqueue()` gets `functions/task-already-exists` for a
  task that already ran, and nothing ever picks it up. This is an emulator
  fidelity gap, not a design flaw — see the composite-index and
  `fieldOverrides` gaps already documented in `AGENTS.md` for the same
  category of problem elsewhere in this project. `tallyPoll.test.ts` and
  `rebuildQaBoard.test.ts` work around it with a deliberate ~5.5s wait before
  writes that need a guaranteed-fresh bucket; see the comments at each wait.
- `npm run test:functions` runs `vitest` with `--no-file-parallelism`. These
  are integration tests against one shared emulator instance, not independent
  unit tests — running the files concurrently fights the emulator's own
  concurrency rather than saving real time.
- `firebase.json`'s `functions` emulator has no `host: "0.0.0.0"`, unlike
  firestore/auth/storage/ui. Those need LAN reachability so a phone or the
  console can reach them; the functions emulator is only ever called by other
  local emulators (Cloud Tasks, Eventarc) and the CLI itself, never directly
  by a device.
- ⚠️ **Superseded by decision 12** — `onSessionAgendaChange` (#8) *is* now
  debounced, though not through a Cloud Tasks queue. The reasoning below is
  still why it is not queued the way #4/#5 are; what it got wrong is that
  "rare enough per session" is not the same as "rare enough per event", and a
  bulk import makes hundreds of sessions rare-per-session simultaneously.
  Original note, kept because its argument is still load-bearing:
  `onSessionAgendaChange` (#8) is not debounced, unlike #4/#5 — a room/time/
  day change or a cancellation is rare enough per session, and important
  enough per attendee, that batching it behind a Cloud Tasks queue would only
  add latency for no real benefit. It gates on `before.status`, not
  `after.status`: a session that *was* published is the one attendees could
  have saved, so that's the check that matters, and checking it this way
  is also what lets a published→cancelled transition still notify on its way
  out. The notification id is the triggering event's own id (`event.id`),
  not `sessionId` like `onAnnouncementCreate` uses — a session can change
  again later, and each change is its own notification, so collapsing them
  onto one fixed id would let a second room change silently overwrite the
  first attendee-visible notice instead of adding to it.
- **Fourteen deployable units, not ten.** The ten Firestore triggers above,
  plus the two Cloud Tasks handlers (`tallyPoll`, `rebuildQaBoard`) and the two
  HTTPS callables. Each deploys as its own Cloud Run service with its own
  container image lineage in Artifact Registry. Every doc in this repo that
  says "8 triggers" is counting the Firestore triggers only; deploy cost, image
  count and attack surface are all sized on fourteen.
- **Runtime options are set and untested against a real deploy.** All fourteen
  now carry `region: 'us-central1'` (inside `nam5`, where the `(default)`
  database permanently lives), `memory: '256MiB'`, `timeoutSeconds: 60`,
  `minInstances: 0`, `concurrency: 80` and `maxInstances: 10` — with the two
  public callables at `maxInstances: 3` and `onSessionAgendaChange` at
  `maxInstances: 1, concurrency: 1` (decision 13). Both Cloud Tasks queues also
  carry `rateLimits: { maxConcurrentDispatches: 5, maxDispatchesPerSecond: 10 }`.
  None of this has been observed on a deployed service; the emulator does not
  enforce any of it, exactly as it does not enforce composite indexes. **Verify
  in the Cloud Run console after the first deploy** — see
  `docs/deploy-functions.md`.
- ⚠️ **`directory/{uid}` is still client-writable, and that is one half of a
  loop.** `mirrorDirectory` writes `directory/{uid}` on every write to
  `users/{uid}`. A trigger added on `directory/{uid}` that writes back to
  `users/{uid}` closes the circuit into an unbounded loop between two
  documents, billing every hop, with no natural stopping point. Nothing guards
  against it — Firestore v2 triggers matching an exact path is the only reason
  none of the fourteen existing functions can loop, and that protects you only until
  somebody registers the second half. The warning is also in the docblock of
  `mirror-directory.ts`, where an author would actually be standing.
- ⚠️ **`exhibitorListings/{id}` is the second projection with the same loop
  hazard.** #11 writes it on every write to `exhibitors/{id}` and #12 on every
  occupancy change in `booths/{id}`. Neither writes back to either source, and a
  trigger on `exhibitorListings` that did would close the circuit into an
  unbounded loop billed per hop. Unlike `directory/{uid}`, this collection is
  `allow write: if false` for every client, so the seed and these two triggers
  are the only writers. The warning is repeated in the docblocks of
  `mirror-exhibitor-listing.ts` and `lib/exhibitor-listing.ts`.
- Nothing remaining — Phase 1's ten functions are all built, and #11–#12 were
  added on 2026-08-31 (FU-15). See
  `BACKEND-ROADMAP.md` for what's next (Phase 2 onward), and
  `docs/deploy-functions.md` for the ordered deploy.
