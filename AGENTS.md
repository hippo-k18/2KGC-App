# Working in this repo

Read this before writing any code.

## What this is

A cross-platform native mobile app — a Whova alternative for Knowledge Graph
Conference 2026 — running on **both iPhone and Android** from one codebase.

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

Every tab is **intentionally blank**, rendering only the words
`KGC WHOVA DEMO` from `src/components/demo-screen.tsx`. Headers are hidden; the
bottom tab bar is the only chrome. This is an explicit instruction from the
owner, not an oversight. **Do not add UI to the tabs unless asked.**

```
src/
  app/
    _layout.tsx            root stack, theme, auth providers, splash
    index.tsx              routes to /login or /home
    login.tsx              demo sign-in screen
    +not-found.tsx
    (tabs)/
      _layout.tsx          the five native tabs
      home/ agenda/ attendees/ community/ messages/
                           each: _layout.tsx + a blank index.tsx
  components/              text, screen, card, avatar, empty-state, demo-screen
  config/                  event.ts, demo.ts
  constants/theme.ts       brand palette, spacing, radii
  hooks/use-theme.ts
  lib/
    auth/                  auth-provider.tsx (Firebase), demo-auth.tsx (fake)
    firebase/              client.ts, collections.ts
  types/
    models.ts              every Firestore document shape
    firebase-auth-rn.d.ts  a type patch — see gotcha 5
firestore.rules · firestore.indexes.json · storage.rules · firebase.json
```

Path aliases: `@/*` → `src/*`, `@/assets/*` → `assets/*`.

## How to verify a change

There is no test suite. Always run:

```bash
npm run typecheck                    # tsc --noEmit
npx expo export --platform ios
npx expo export --platform android   # do not skip this one
```

Typecheck alone is **not sufficient** — it does not catch module-resolution
failures. Bundling both platforms does. Android has been broken by iOS-only
code more than once here.

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
`src/types/firebase-auth-rn.d.ts` patches this with a module augmentation.
**Do not "fix" it by adding `@firebase/auth` as a direct dependency** — a second
copy at a different version yields two separate auth instances and fails in
confusing ways.

**6. Firebase must stay lazily initialised.**
`src/lib/firebase/client.ts` initialises inside functions, never at module
scope. Eager initialisation crashes the app when `.env.local` is absent.

**7. Env vars need the `EXPO_PUBLIC_` prefix** and are compiled into the bundle.
After changing them restart with `npx expo start -c`; a plain restart will not
pick them up.

## Data model

Typed in `src/types/models.ts`. Collection names live in
`src/lib/firebase/collections.ts` — **never** spell them as string literals.

**Top-level:** `registrations` (imported ticket list), `users`, `sessions`,
`speakers`, `sponsors`, `tracks`, `threads`, `communityPosts`, `announcements`.

**Subcollections:** `users/{uid}/savedSessions`, `savedContacts`,
`notifications`, `fcmTokens`; `sessions/{id}/questions` and `/polls`;
`threads/{id}/messages`; `communityPosts/{id}/replies`; `sponsors/{id}/leads`.

Two decisions worth preserving:

- **Thread IDs are deterministic** — the two participant uids sorted and joined
  with `_`, so a pair of attendees always maps to exactly one conversation.
- **Sessions carry a denormalised `day` string** (`YYYY-MM-DD` in Eastern Time)
  so day tabs query by equality rather than timezone-aware ranges.

## Security model

`firestore.rules` is default-closed and is **the entire security boundary**.

The gate is `isRegistered()`, which checks the signed-in user's email against
the `registrations` collection. Being signed in is not sufficient — anyone can
create a Firebase account, but only ticket holders are on that list.

This moved out of a server route during the rebuild: the web version checked
the ticket list in an API route using the Admin SDK, and a native app has no
server. The cost is one extra document lookup per rule evaluation. When Cloud
Functions are added, set a custom claim at first sign-in and check
`request.auth.token.registered` instead.

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

- **Auth is not finished.** `src/lib/auth/auth-provider.tsx` holds the Firebase
  wiring, but login actually uses `src/lib/auth/demo-auth.tsx` — a hard-coded
  string comparison (`demo@kgc.tech` / `kgc2026`) with no server and no
  security; the credentials are readable in the bundle. Delete
  `src/config/demo.ts` and `demo-auth.tsx` when real auth lands.
- **Email-link sign-in needs deep linking**, which cannot be tested in Expo Go.
  The alternative is a six-digit code via a Cloud Function. Decision still open.
- **No Firebase project exists yet.** No `.env.local`, so nothing reads from
  Firestore. Rules and indexes are written but never deployed.
- **No rules tests.** `firestore.rules` is the whole security boundary and is
  unverified. `@firebase/rules-unit-testing` against the emulator is the
  natural next step.
- **Push notifications are not implemented.** `fcmTokens` and `PushTokenDoc`
  exist; nothing writes to them. Push also needs a development build — Expo Go
  cannot receive it.
- **App icon and splash are still Expo's defaults** in `assets/images/`.
- **No sign-out control.** The demo session is in-memory only, so reloading
  returns to the login screen. Intentional.

## Suggested next steps

Confirm with the owner before starting — the tabs are blank on purpose.

1. Create the Firebase project, fill `.env.local`, deploy rules and indexes.
2. Import scripts for `registrations`, `sessions`, `speakers`, `tracks`.
3. Decide the auth mechanism and finish it.
4. Agenda list + session detail + personal agenda — the biggest gap vs Whova.
5. Attendee directory and 1:1 messaging.
6. Community board, sponsors, push, live Q&A and polls.
