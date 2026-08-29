# Working in this repo

Read this before writing any code.

## What this is

A cross-platform native mobile app — a Whova alternative for Knowledge Graph
Conference 2027 — running on **both iPhone and Android** from one codebase.

It is **not** a web app. An earlier version was Next.js; it was replaced
entirely in July 2026. If you find advice referring to `proxy.ts`, App Router,
PWA manifests, service workers or `NEXT_PUBLIC_*`, it is describing the dead
version. Ignore it.

## Stack

Expo SDK **54.0.36** · React Native 0.81.5 · React 19.1.0 · expo-router 6.0.24
· TypeScript · Firebase (Firestore, Auth, Storage) · Zod · date-fns

**These versions are probably newer than your training data.** Verify APIs
against the installed type definitions under `node_modules/`, not from memory
and not from web tutorials. Tutorials written for SDK 55+ will actively
mislead you — see gotcha 2.

## Current state

All five tabs are built and render real data from Firestore: Home (now/next,
announcements), Agenda (day tabs, track filters, search, session detail, add to
schedule), People (attendees / speakers / sponsors segments), Community (posting,
replies, reactions) and Me (profile, my schedule, privacy). Messages is a header
icon with an unread badge rather than a tab.

There is also a marketing/ticketing website at `apps/web/` (Next.js, Stripe
Checkout) and an organizer console at `apps/console/`. **Neither is a root
workspace member** — that is deliberate, and it means you install and run each
from its own directory.

**Built end to end:** the check-in loop. Ticket purchase on the website →
confirmation page behind an HMAC capability token → sign-in → the badge QR at
`me/badge` → a scan at the console's desk → an idempotent `checkIns` document,
with the badge reflecting it live. Verified as one continuous run, not screen by
screen.

**Not built or only partly wired:** the organizer console is close to empty, push
notifications do not exist, badge *printing* (`badgeTemplates`,
`badgePrintJobs`) is still only modelled, and Session Q&A and polls render but
their tallies never move. See `whova-rebuild/STATUS.md`
and the parity tables beside it for a measured breakdown — the honest headline is
**roughly 13% of Whova by feature count** (app 47 built / 25 partial of 241 rows;
console 0 built / 7 partial of 136), and the reason so much sits at "partial" is
almost always the Spark plan rather than missing UI.

As of WP-01 this is an **npm workspace monorepo**, not a single Expo project at the
repo root. `models.ts` and `collections.ts` moved out of the app into
`packages/shared`, because Cloud Functions (WP-02) and the future admin console need
the same document types and must not duplicate them.

```
package.json               workspaces: ["app", "functions", "packages/*", "scripts"]
firestore.rules · firestore.indexes.json · storage.rules · firebase.json · .firebaserc
tests/rules/                140 tests — the security boundary
tests/qr/                   9 tests — the badge QR encoder, against a reference encoder
functions/                  empty — WP-02 fills this, once the project is on Blaze
packages/shared/
  package.json              "@kgc/shared" — plain TS, no React, no Firebase SDK import.
                            "type": "module", so index.ts re-exports use `.js`
                            specifiers. Dropping them builds fine and breaks Node.
  src/
    models.ts               every Firestore document shape
    collections.ts          collection names — never spell them as string literals
    event.ts                EVENT_ID and TIME_ZONE — shared so they cannot drift
    index.ts                re-exports all three
scripts/                    "@kgc/scripts" — Admin SDK tooling, runs on a laptop
  src/
    seed-demo.ts            `npm run seed` — idempotent demo data
    import-whova.ts         `npm run import:whova` — the generic CSV importer
    lib/time.ts             wall clock → UTC + day key. The riskiest code here;
                            lib/time.test.ts pins it.
app/
  package.json
  app.json · tsconfig.json
  metro.config.js           extends watchFolders/nodeModulesPaths for the workspace —
                             see "How to verify a change"
  .env.example
  src/
    app/
      _layout.tsx            root stack, theme, auth providers, splash
      index.tsx              routes to /login or /home
      login.tsx              demo sign-in screen
      +not-found.tsx
      (tabs)/
        _layout.tsx          Home · Agenda · People · Community · Me
        home/ agenda/ people/ community/ me/
                             agenda and people have [id]/[uid] detail routes;
                             community has [id]; me has schedule.tsx and
                             badge.tsx — the check-in QR
      messages/              inbox + [threadId] — deliberately NOT a tab
    components/              text, screen, screen-header, list-row, session-card,
                             filter-chip, avatar, empty-state, messages-button
    config/event.ts          re-exports EVENT from @kgc/shared
    lib/data/                one hook module per domain; use-collection.ts is the
                             error-safe listener every one of them should use.
                             badge.ts holds the QR-payload decision — read its
                             header before touching anything check-in shaped.
    lib/qr/encode.ts         a dependency-free QR encoder. Hand-rolled because
                             every npm QR component needs react-native-svg, and
                             Expo Go ships a fixed set of native modules.
    constants/theme.ts       brand palette, spacing, radii
    hooks/use-theme.ts
    lib/
      auth/                  auth-provider.tsx — real Firebase auth
      firebase/              client.ts — collections now live in @kgc/shared
    types/
      firebase-auth-rn.d.ts  a type patch — see gotcha 5
```

Path aliases: `@/*` → `app/src/*`, `@/assets/*` → `app/assets/*`, both resolved from
inside the `app` workspace. `@kgc/shared` is a real npm workspace package — `npm
install` at the repo root symlinks it into the root `node_modules`, there is no
build step, and its `package.json` `main`/`types` point straight at `src/index.ts`.

`.env.local` lives at `app/.env.local`. Set `EXPO_PUBLIC_USE_EMULATOR=1` to run
against the local Firestore/Auth emulators with seeded data — that is the normal
way to develop, and it needs neither credentials nor the Blaze plan. On a physical
device set `EXPO_PUBLIC_EMULATOR_HOST` to your Mac's LAN IP, because `localhost` on
a phone means the phone. The emulators must also be bound to `0.0.0.0`
(`firebase.json` already does this) or the device cannot reach them.

**The emulator does not enforce composite indexes.** A query with no matching entry
in `firestore.indexes.json` works locally and fails with `failed-precondition` in
production. Two screens shipped broken this way and nobody noticed, because the
hooks render an empty state on error. Add the index when you add the query.

**It does not enforce `fieldOverrides` either, and that bit harder.** An override
of `"indexes": []` turns *single-field* indexing off for a field, which makes any
`orderBy` on it fail in production — and the emulator ignores index configuration
completely, so the query passes every local run. `scanEvents.scannedAt` was
overridden to `[]` while `recentScanEvents()` ordered by it: the console's scan log
would have failed the first time it was opened live. The override has been removed
(DESCENDING re-enabled) and the reasoning is recorded in the `recentScanEvents()`
docblock in `apps/console/src/lib/checkin.ts`, because JSON cannot hold a comment.
When you read an override, check nothing orders by that field.

## How to verify a change

Run from the repo root:

```bash
npm run typecheck                    # forwards to the app workspace
npm run typecheck --workspace=@kgc/scripts
npm run test:rules                   # 140 tests against firestore.rules
npm test                             # 35 unit tests: timezone derivation and the QR encoder
```

`test:rules` runs the Firestore emulator, which **requires Java**. If you see
"Unable to locate a Java Runtime":

```bash
brew install openjdk
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"   # add to ~/.zshrc to persist
```

Then, from inside `app/` — Metro needs to run from the actual Expo project root,
there is no root-level equivalent:

```bash
npx expo export --platform ios
npx expo export --platform android   # do not skip this one
```

Typecheck alone is **not sufficient** — it does not catch module-resolution
failures. Bundling both platforms does. Android has been broken by iOS-only
code more than once here, and the monorepo move added a second way for that class
of bug to appear: `app/metro.config.js` has to explicitly add the workspace root to
`watchFolders` and `resolver.nodeModulesPaths`, because Metro (unlike `tsc`) does not
walk up the tree to find `@kgc/shared`'s hoisted symlink on its own. If that config
ever regresses, `tsc` stays green while both exports fail.

Setup and run instructions for humans are in `README.md`.

## Gotchas that have already caused real bugs

**1. Expo Go supports exactly one SDK — currently 54.**
`create-expo-app@latest` scaffolds SDK 57, which Expo Go cannot open at all
("Project is incompatible with this version of Expo Go"), and it cannot be
fixed from the Expo Go side. This project was deliberately downgraded to 54.
**Do not upgrade the SDK** unless the owner has chosen to move to development
builds. Current Expo Go SDK: <https://expo.dev/go>.

**2. Native tabs use the SDK 54 API, which differs from newer docs.**

```tsx
// SDK 54 — correct here. Icon and Label are top-level imports.
import { Icon, Label, NativeTabs, VectorIcon } from 'expo-router/unstable-native-tabs';

<NativeTabs.Trigger name="home">
  <Icon sf="house.fill" />
  <Label>Home</Label>
</NativeTabs.Trigger>

// SDK 55+ — WRONG here, will not compile
<NativeTabs.Trigger.Icon sf="house.fill" />
```

**3. Every tab icon must be specified twice.**
`sf` is SF Symbols and is **iOS-only**. Supplying only `sf` leaves Android with
labels and no icons at all. Always pair it with `androidSrc`:

```tsx
<Icon
  sf={{ default: 'house', selected: 'house.fill' }}
  androidSrc={<VectorIcon family={MaterialIcons} name="home" />}
/>
```

Android icon names: <https://icons.expo.fyi>.

**4. `ThemeProvider` is not exported by expo-router 6.**
Import `ThemeProvider`, `DefaultTheme` and `DarkTheme` from
`@react-navigation/native`. expo-router 7 re-exports them; version 6 does not.

**5. `getReactNativePersistence` is missing from `firebase/auth`'s types.**
It exists at runtime but not in the declarations, because the umbrella
package's `types` field points at a browser-only file.
`app/src/types/firebase-auth-rn.d.ts` patches this with a module augmentation.
**Do not "fix" it by adding `@firebase/auth` as a direct dependency** — a second
copy at a different version yields two separate auth instances and fails in
confusing ways.

**6. Firebase must stay lazily initialised.**
`app/src/lib/firebase/client.ts` initialises inside functions, never at module
scope. Eager initialisation crashes the app when `.env.local` is absent.

**7. Env vars need the `EXPO_PUBLIC_` prefix** and are compiled into the bundle.
After changing them restart with `npx expo start -c`; a plain restart will not
pick them up.

## Data model

Typed in `packages/shared/src/models.ts`, imported as `@kgc/shared`. Collection
names live in `packages/shared/src/collections.ts` — **never** spell them as
string literals.

**Top-level:** `registrations`, `users`, `directory`, `sessions`, `speakers`,
`sponsors`, `tracks`, `rooms`, `threads`, `communityPosts`, `announcements`, plus
the modelled-but-unbuilt `checkInLists`, `checkInStations`, `scanEvents`,
`badgeTemplates`, `badgePrintJobs`, `ticketTypes`, `orders`.

**Subcollections:** `users/{uid}/savedSessions`, `savedContacts`,
`notifications`, `fcmTokens`, `entitlements`; `sessions/{id}/questions`
(`/upvotes`), `/polls` (`/votes`), `/qaBoard`, `/materials`;
`threads/{id}/messages`; `communityPosts/{id}/replies`, `/reactions`;
`sponsors/{id}/leads`; `checkInLists/{id}/checkIns`.

Decisions worth preserving — do not "simplify" these:

- **Thread ids are deterministic** — the two uids sorted and joined with `_`, so
  a pair maps to one conversation. **Membership is *not* derivable from that id.**
  An earlier version proved membership by splitting the id on `_`, on the stated
  assumption that "Firebase uids are alphanumeric, so the separator is
  unambiguous". Uids are not: the demo accounts are `demo_000`, `demo_001`, so
  `demo_000_demo_001` split into four pieces containing neither participant and
  **every message read and send was denied**. Membership comes from the
  `participantIds` array on the thread document, and nothing anywhere parses a
  thread id to find a person. The same mistake was made independently in the
  thread-title code; if you find a third instance, it is a bug.
- **Sessions carry a denormalised `day` string** so day tabs query by equality
  rather than timezone-aware ranges. Local wall time (`startsAtLocal` +
  `timeZone`) is the authoring truth; `startsAt`/`endsAt`/`day` are derived from
  it **server-side**. A 21:00 reception is 01:00 UTC the next day.
- **Reactions, upvotes and poll votes are uid-keyed subcollections**, never maps
  or arrays, because rules cannot verify that a writer touched only their own
  entry inside one. Poll votes were a `Record<uid, number>` map once: 1,000
  voters against a ~1 write/sec/document limit took **16m40s** to drain.
- **Counters and tallies are function-owned.** `replyCount`, `reactionCount`,
  `upvoteCount`, `tallies`, `totalVotes` appear in no client allowlist.
- **`eventId` is on every top-level document** and leads every composite index.
  Firestore cannot add a field to an existing index, so this is not retrofittable
  without a full rebuild and backfill.
- **Ids that leave the building are opaque.** `registrations` is keyed by a
  server-minted id, and only `qrSecret` — never a uid — goes into a badge QR.
- **`checkIns` and `scanEvents` are keyed for idempotency**
  (`{listId}/{registrationId}`, `{deviceId}_{clientScanId}`). A duplicate scan is
  a `create` that fails with `already-exists`, and *that failure is the
  mechanism* — there is no read-then-write race to lose.

### The badge QR payload, and the threat it accepts

The payload is the registration's `qrSecret`, alone — no email, no uid, no
`registrationId`, no envelope. The full argument is in the header of
`app/src/lib/data/badge.ts`; this is the summary, because it is the one decision
on this path that is expensive to revisit.

Rejected: an **email** turns a badge held up in a hall into a thousand harvestable
addresses. A **`registrationId`** is worse than it looks — it is
`reg_` + sha256(email), so anyone who knows an address can compute it, which is
also why `/order/{token}` exists on the website. A **uid** would join one
photograph to the profile, the messages and the saved sessions.

Rejected with more regret: a **short-lived signed token**. Verifying a signature
needs a key at the door; a key in the app bundle is not a secret, and a
per-attendee key is `qrSecret` again — so the honest form is TOTP, which requires
the phone's clock and the reader's clock to agree *while both are offline*, which
is the exact situation the badge exists for. Every offline verifier must tolerate
skew, and the skew window **is** the replay window, so the scheme widens the thing
it was adopted to narrow. Offline and replay resistance are in genuine tension
here and this resolves in favour of offline: a badge that fails in a basement
fails at the only moment it is ever used.

**The accepted threat, plainly: `qrSecret` is a long-lived bearer credential for
attendance.** Photograph the screen and you can be checked in as that attendee.
Bounded by four things — it grants attendance and nothing else (it is not a
sign-in credential; `claimCode` is, and is deliberately separate); the theft is
detected rather than silent, because the real attendee's scan returns "already
checked in at 09:12 at Front desk 1" and `scanEvents` names the device; it is
revocable by rotating the secret, which no client may do; and at 192 random bits
it is neither guessable nor enumerable. **Not** accepted, and closed in the rules:
identity disclosure, enumeration of the ticket list, and self-check-in.

If `expo-crypto` is ever added, revisit one detail: the badge finds its
registration with a filtered *query* on `email` only because the client cannot
compute sha256 and therefore cannot address the document directly. A `getDoc` on
the derived id would need no `list` rule at all.

## Security model

`firestore.rules` is default-closed and is **the entire security boundary**.

The gate is `isRegistered()`, which checks the **`registered` custom claim** on
the ID token. Being signed in is not sufficient — anyone can create a Firebase
account, but the claim is minted only for ticket holders. `roles` is a claim too,
and it is a **list**, because a speaker is also an attendee.

Nothing in the file reads a document to decide who you are. An earlier version
looked up `registrations` and `users` on every evaluation; besides being billed
per read, that counts against the cap of 10 access calls per single-document
request and 20 per query, which is a hard error rather than a slowdown.

Four things to know before editing it:

- **Counters and tallies are server-owned.** `replyCount`, `reactionCount`,
  `upvoteCount`, poll `tallies` and `totalVotes` appear in no client allowlist.
  Cloud Function triggers write them and bypass rules.
- **Rules filter documents, not fields.** The attendee directory is therefore a
  separate `directory/{uid}` projection written by a trigger, not a filtered view
  of `users/{uid}`. Opting out deletes the projection, so a hidden attendee's
  record never leaves the server.
- **Thread membership is read from the thread document**, never inferred from the
  thread id. See the data-model note above for why — it is the worst bug this repo
  has had, and the comment justifying it read as entirely reasonable.
- **A `get()` on the parent is required on the `messages` path**, and it is one of
  three in the file. The second is on the poll-vote write path, checking that a
  poll is still open. The third is on `checkInLists/{id}/checkIns/{registrationId}`,
  resolving whether that check-in belongs to the caller — the id is
  `reg_` + sha256(email) and rules cannot hash, so the registration has to be read.
  All three are deliberate and documented in place. Adding a fourth is a decision,
  not a detail: the cap is 10 access calls per single-document request and 20 per
  query, and exceeding it is a hard error, not a slowdown.
- **The ticket list is no longer closed outright.** `registrations` was
  `allow read, write: if false`; it is now readable, and *only* readable, by the
  holder, matched on the token's email address folded to lower case. That is forced:
  `qrSecret` is the badge, there is no Cloud Function to hand it over on Spark, and
  the rules are the entire read path. It stays unenumerable — a query must be
  filtered to the caller's own address — and the only writable field is
  `claimedByUid`.
- **Attendees cannot check themselves in.** Every write under `checkInLists`,
  `scanEvents` and `checkInStations` is denied to every client including organizers,
  because the console writes them with the Admin SDK and bypasses rules entirely.
  If the console ever stops using the Admin SDK, those paths need a rule, not a
  loosening.
- **`list` and `get` are not the same rule.** A predicate reading `resource.data`
  works on a single-document `get` and evaluates against null on a `list`, denying
  the whole query. The inbox broke this way once. If a rule guards a collection
  anyone queries, test both verbs.

`tests/rules/firestore.test.ts` has **140 tests, one per invariant**. It has been
mutation-checked: breaking `isRegistered()` fails exactly the test that names that
guarantee. Add a test whenever you add a rule — the suite is the only thing
standing between this file and 1,000 attendees' data.

## Conventions

- **Never add Claude attribution to commits or PRs.** No `Co-Authored-By`, no
  `Claude-Session` trailer, no "Generated with Claude Code" footer. This is a
  standing instruction from the owner.
- Commit messages: imperative subject, then prose explaining *why*, not a
  bulleted restatement of the diff.
- Colours come from `useTheme()`. Never hard-code a hex value in a screen.
- Match the surrounding style. Comments explain reasoning, not mechanics.
- Prefer editing existing files over adding new ones.
- **Everything that ends up in a file is written in English** — code,
  comments, identifiers, commit messages, and documentation such as
  `functions/SPEC.md`. This holds even when the person you're working with
  writes to you in another language; reply to them in their language, but
  write the file in English, for consistency with the rest of the project.
  **Exception: `BACKEND-ROADMAP.md` stays in French.** It is the owner's
  personal working log, not project documentation meant for a general
  contributor audience, and it was written in French from its first line.
  Continue in French there; do not translate it into English and do not
  treat its language as a violation of this rule.

## Known gaps

- **Auth is real but the sign-in method is not the shipping one.** Accounts,
  the `registered` / `roles` custom claims and the rules that read them are all
  genuine — but the login screen uses email + password against the Auth
  emulator, because the production design (a six-digit code verified by a Cloud
  Function) needs Blaze. The hard-coded `demo-auth.tsx` is deleted.
- **`users/{uid}` creation on first sign-in is resolved, not a gap.**
  `AuthProvider`'s `useCreateProfileOnFirstSignIn`
  (`app/src/lib/auth/auth-provider.tsx`) has written it since commit
  `fadee27` ("Close the gaps an adversarial audit found in the rules and
  data layer", 2026-08-16) — before this file's Phase 0/1 backend work even
  started. A stale claim to the contrary sat here and in
  `BACKEND-ROADMAP.md`'s Phase 2 until 2026-08-26, discovered while
  reasoning about whether `onAnnouncementCreate`'s fan-out (which treats
  every `users/{uid}` doc as a registered attendee) could reach a real,
  non-seeded participant. It can.
- **Offline does not work yet.** Several comments claim it does; they are
  aspirational. The Firebase **JS** SDK has no disk persistence on React Native,
  so the cache is memory-only and a cold start with no network renders nothing.
  Real offline needs the `@react-native-firebase/*` migration in WP-06 — which
  is also the single most persuasive moment in the demo script.
- **The Firebase project exists but isn't fully provisioned.** `kgc-database`
  (display name "kgc-2026", project number `669841225737`) exists. Firestore's
  `(default)` database exists too: **Native mode, Standard edition, location
  `nam5`** (US multi-region) — that location is permanent and cannot be changed.
  `.env.local` exists and is populated with all six `EXPO_PUBLIC_FIREBASE_*`
  values (though see the note above — it needs to live in `app/.env.local`, not
  the repo root, for Expo to actually pick it up). **The project is still on the
  Spark plan**, so Cloud Functions cannot be deployed yet — that blocks WP-02
  until it's upgraded to Blaze. Rules and indexes are written but **never
  deployed**.
- **The aggregate triggers do not exist yet.** The model says `replyCount`,
  `reactionCount`, `upvoteCount`, `tallies`, `totalVotes` and `directory/{uid}`
  are function-owned, and the rules enforce that no client may write them — but
  the seven Cloud Function triggers that *should* write them are unbuilt, because
  the project is on Spark. Until they exist those fields stay at their seeded
  values and the directory is not mirrored. Nothing is wrong; it is simply
  half-wired, and the half that is wired is the half that protects data.
- **`SessionDoc` carries denormalised caches** (`speakerNames`, `roomName`,
  `primaryTrackName`, `primaryTrackColor`) so the agenda list renders without N
  extra reads. Nothing is ever *decided* from them — they are display-only, and
  the importer owns them.
- **Push notifications are not implemented.** `fcmTokens` and `PushTokenDoc`
  exist; nothing writes to them. Push also needs a development build — Expo Go
  cannot receive it.
- **The app claims capabilities it does not have.** This is the recurring defect
  class here, not an occasional slip: **fourteen** cases have been found, three of
  them introduced by agents cleaning up the other eleven. A privacy switch that
  said it blocked messages, an offline story that cannot work on this SDK, a
  comment asserting an id format that the seed data contradicts. Before you write
  reassuring microcopy, exercise the path. Before you trust a comment, check it
  against the data.

## Suggested next steps

1. Upgrade `kgc-database` to Blaze (currently Spark). It is the single
   highest-leverage change available: it converts roughly twelve inert fields —
   every counter, every poll tally, the directory mirror, push — into working
   features, and unblocks the seven aggregate triggers at once. Then deploy rules
   and indexes, which are written but have **never been applied**.
2. The organizer console (`apps/console/`) is the weakest area by far and the one
   the owner has said must end up "almost identical" to Whova's. Its
   `src/lib/nav.ts` encodes Whova's IA as 163 nodes and mislabels many of them
   "built" when they are view-only — do not trust it as a progress map.
3. Finish check-in: `checkInLists`, `checkIns`, `scanEvents` and `checkInStations`
   are modelled and have **no rules at all**, so default-deny is currently the
   only thing protecting them.
4. Session Q&A and live polls exist as components but their tallies are inert
   until (1).
