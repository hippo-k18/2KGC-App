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
| 7 | `onAnnouncementCreate` | Firestore trigger | `announcements/{id}` | `onCreate` | `users/{uid}/notifications/{id}` (type `announcement`) for every attendee with `notificationPrefs.announcements == true`; also sends FCM if `announcement.push == true` | Must not notify unregistered accounts. Batch the writes (Firestore's 500-op/batch limit, so ~2 batches for 1000 users). |
| 8 | `onSessionAgendaChange` | Firestore trigger | `sessions/{sessionId}` | `onUpdate`, filtered to `status == 'published'` and a change to `roomId` / `startsAtLocal` / `endsAtLocal` / `day` / `status → cancelled` | `users/{uid}/notifications/{id}` (type `agenda-change`) + FCM push, for every attendee with this `sessionId` in `savedSessions` (collection group query) | Must not fire on a cosmetic change (`description`, `slidesUrl`, a cached `speakerNames`) — only fields that change where/when/whether the session happens. **Notifies unconditionally**: there is no dedicated preference in `notificationPrefs` for this type, and there won't be — decision made, no new checkbox. |
| 9 | `requestOtp` | HTTPS callable (no Firestore trigger) | — | client call (email) | `otpCodes/{id}`: 6-digit code, `expiresAt` = +10 min, `attempts: 0`; `rateLimits/{id}`: throttle **5 requests per email per hour** | Must never return a different response depending on whether the email matches a ticket (same anti-enumeration logic as `registrationIsMine`). Must not send a real email — emulator console log only, until a provider is chosen in Phase 5. |
| 10 | `verifyOtp` | HTTPS callable | — | client call (email + code) | Auth account (find-or-create by email); custom claims `{ registered: true, roles: ['attendee'], eventId }`; returns a custom token; increments `attempts` on `otpCodes` on failure, refuses after expiry (10 min) or too many attempts | Must **not** create `users/{uid}` — that stays the client's job on first sign-in (a known Phase 2 gap). **`roles` is always `['attendee']`** on first sign-in, never derived from a `speakers`/allowlist lookup — special roles (`organizer`, `speaker`, `reviewer`, `exhibitor`, `checkin`) stay manually granted via `npm run claims`, an explicit decision to avoid the complexity of an untested automatic lookup. |

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
3. **`verifyOtp`/`requestOtp`**: both are in scope for Phase 1. No real email
   is sent until a provider is chosen (Phase 5) — the code is logged to the
   console on the emulator.
4. **Push for Phase 1**: only `onAnnouncementCreate` and
   `onSessionAgendaChange`. The scheduled reminder and the message
   notification are deferred.
5. **`onSessionAgendaChange` has no dedicated preference**: it notifies every
   affected attendee unconditionally, no new field in `notificationPrefs`.
6. **Roles on first sign-in**: always `['attendee']` by default, never
   auto-derived. Special roles go through `npm run claims` (manual), the same
   as for seeded accounts today.
7. **`qaBoard/current`**: a strict filter on `state == 'approved'` before
   writing. No unmoderated content in the public document.
8. **Missing index**: added in this same phase — `firestore.indexes.json`
   now has a `savedSessions.sessionId` override with `COLLECTION_GROUP`
   scope, needed so `onSessionAgendaChange` (#8) can find every attendee who
   saved a given session, across all users.
9. **`requestOtp` thresholds**: 5 requests per email per hour; a code is
   valid for 10 minutes.

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
- `onReplyWrite`, `onReactionWrite` and `onQuestionUpvoteWrite` (#1–#3) are
  built and tested against the emulator with seeded data —
  `tests/functions/`, run via `npm run test:functions`.
- `tallyPoll` and `rebuildQaBoard` (#4, #5) still need their Cloud Tasks
  wiring, which has its own emulator configuration — to be validated when
  those are built, not assumed here.
