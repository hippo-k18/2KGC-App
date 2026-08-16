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

`app/src/components/demo-screen.tsx` is the old placeholder and is no longer
rendered by anything — it can be deleted.

**Not built:** session Q&A and live polls, push notifications, the organizer
console, check-in, badges, registration. See `whova-rebuild/STATUS.md` for a
measured breakdown; the short version is that the attendee app's demo tier is
roughly two-thirds done and everything server-side is at zero.

As of WP-01 this is an **npm workspace monorepo**, not a single Expo project at the
repo root. `models.ts` and `collections.ts` moved out of the app into
`packages/shared`, because Cloud Functions (WP-02) and the future admin console need
the same document types and must not duplicate them.

```
package.json               workspaces: ["app", "functions", "packages/*", "scripts"]
firestore.rules · firestore.indexes.json · storage.rules · firebase.json · .firebaserc
tests/rules/                47 tests — the security boundary
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
                             community has [id]; me has schedule.tsx
      messages/              inbox + [threadId] — deliberately NOT a tab
    components/              text, screen, screen-header, list-row, session-card,
                             filter-chip, avatar, empty-state, messages-button
    config/event.ts          re-exports EVENT from @kgc/shared
    lib/data/                one hook module per domain; use-collection.ts is the
                             error-safe listener every one of them should use
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

## How to verify a change

Run from the repo root:

```bash
npm run typecheck                    # forwards to the app workspace
npm run typecheck --workspace=@kgc/scripts
npm run test:rules                   # 47 tests against firestore.rules
npm test                             # 9 unit tests, mostly timezone derivation
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

- **Thread ids are deterministic** — the two uids sorted and joined with `_`. A
  pair maps to one conversation, *and* membership is provable from the path, so
  the `messages` rules need no `get()` on the parent.
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
- **Thread membership is proved from the path.** Thread ids are the two uids
  sorted and joined with `_`, so `messages` needs no `get()` on its parent.
- **There is exactly one `get()` in the file**, on the poll-vote write path, to
  check that a poll is still open. It is deliberate and documented in place.

`tests/rules/firestore.test.ts` has **40 tests, one per invariant**. It has been
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

## Known gaps

- **Auth is real but the sign-in method is not the shipping one.** Accounts,
  the `registered` / `roles` custom claims and the rules that read them are all
  genuine — but the login screen uses email + password against the Auth
  emulator, because the production design (a six-digit code verified by a Cloud
  Function) needs Blaze. The hard-coded `demo-auth.tsx` is deleted.
- **Nothing creates `users/{uid}`.** The seed writes 50 profiles, which is why
  the demo works; a real attendee signing in has no profile document, so their
  name and privacy switches fall back to defaults. `AuthProvider` should create
  it on first sign-in — the rules already permit exactly that shape.
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
- **App icon and splash are still Expo's defaults** in `app/assets/images/`.
- **No sign-out control.** The demo session is in-memory only, so reloading
  returns to the login screen. Intentional.

## Suggested next steps

Confirm with the owner before starting — the tabs are blank on purpose.

1. Upgrade `kgc-database` to Blaze (currently Spark, blocking Cloud Functions),
   move `.env.local` into `app/.env.local`, then deploy rules and indexes —
   written but never applied.
2. Import scripts for `registrations`, `sessions`, `speakers`, `tracks`.
3. Decide the auth mechanism and finish it.
4. Agenda list + session detail + personal agenda — the biggest gap vs Whova.
5. Attendee directory and 1:1 messaging.
6. Community board, sponsors, push, live Q&A and polls.
