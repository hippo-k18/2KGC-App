# KGC — Knowledge Graph Conference app

A cross-platform conference app (a Whova alternative) for KGC 2027, built with
Expo and React Native. **Runs on both iPhone and Android** from one codebase.

> **Working on this with an AI assistant?** Everything it needs — current
> versions, architecture, conventions, and the version-specific traps that have
> already caused bugs here — is in [`AGENTS.md`](./AGENTS.md). Claude Code loads
> it automatically via `CLAUDE.md`. Keep it up to date when things change.
>
> **This file covers the attendee app in `app/` only.** This repo is an npm
> workspace monorepo with three other pieces, each set up and run from its own
> folder — see [What's in this repo](#whats-in-this-repo) below.

---

## What's in this repo

| Folder | What it is | Status |
| --- | --- | --- |
| `app/` | The attendee mobile app (Expo/React Native) — this README | All 5 tabs built, real Firestore data |
| `apps/web/` | Public ticketing & marketing site (Next.js + Stripe Checkout) | 21 pages. Ticket purchase → check-in verified end to end. Deployed on Netlify |
| `apps/organizer/` | Organizer dashboard (Next.js) — a rebuild of Whova's EMS | **All 173 screens carry real data.** Deployed on Netlify. See `ROADMAP.md` |
| `functions/` | Cloud Functions (counters, directory mirror, push) | **8 triggers written, 14 tests green** on the emulator — not deployed, which needs Blaze |
| `packages/shared/` | Shared TypeScript types and collection names | Used by `app/`, `functions/` and `scripts/` |
| `scripts/` | Admin SDK tooling: demo seeding, Whova CSV import | — |

`apps/web/` (port 3200) and `apps/organizer/` (port 3100) are **not** root
workspace members — install and run each from inside its own folder
(`cd apps/organizer && npm install`, etc.). They use different ports so both can
run at once, which the Stripe webhook needs.

⚠️ Because they are not workspace members, each resolves **its own copy of
`firebase-admin`** — see gotcha 8 in `AGENTS.md` before writing anything that
crosses between them and a Firestore write.

---

## Getting started from nothing

Everything below is free. No Apple Developer account, no Xcode, no Android
Studio. Works on macOS, Windows or Linux. Budget about 15 minutes, most of it
waiting on downloads.

### 1. Install Node.js

Download the **LTS** build from <https://nodejs.org> and run the installer.
Then check it worked:

```bash
node --version    # v20 or newer
```

### 2. Install Git

macOS: `xcode-select --install`
Windows / Linux: <https://git-scm.com/downloads>

```bash
git --version
```

### 3. Get the code

```bash
git clone https://github.com/hippo-k18/2KGC-App.git
cd 2KGC-App
npm install
```

`npm install` takes a few minutes the first time.

### 4. Install Expo Go on your phone

| Phone | Where |
| --- | --- |
| iPhone | App Store → **Expo Go** |
| Android | Play Store → **Expo Go** |

### 5. Start the server

```bash
npm start
```

**Run it from the repo root, and use `npm start` rather than `npx expo start`.**
This is an npm workspace: the Expo project lives in `app/`, so `npx expo start`
at the root finds no entry point and fails with *"Unable to resolve module
./index"*. `npm start` forwards to the right workspace. (`npx expo start` still
works if you `cd app` first.)

A QR code appears in the terminal.

### 6. Open it on your phone

Put the phone on the **same Wi-Fi network** as the computer, then:

- **iPhone** — open the **Camera** app, point at the QR code, tap the banner.
- **Android** — open **Expo Go**, tap *Scan QR code*, point at it.

You should land on the login screen. Sign in with the demo credentials below.

### If the QR code will not connect

Common on corporate, university and guest Wi-Fi, which often block devices from
talking to each other. Route it through Expo's servers instead:

```bash
npm start -- --tunnel
```

Slower, but it works across networks.

### Editing

Change any file under `src/`, save, and the phone reloads in about a second.
That live-reload loop is how the app gets built.

### Other ways to run it

| Command | What it does | Needs |
| --- | --- | --- |
| `npm start` then scan | Real phone via Expo Go | Expo Go, same Wi-Fi |
| `npm run web` | Opens in a browser — quickest for rough layout work | nothing |
| `npm run ios` | iOS Simulator | Xcode **plus a downloaded simulator runtime** |
| `npm run android` | Android emulator | Android Studio with an AVD |

Xcode 26 no longer bundles simulator runtimes; `npm run ios` needs one
downloaded first from Xcode → Settings → Components (several GB). Expo Go on a
real device is quicker and truer.

### Version note

Expo Go supports exactly one SDK at a time — currently **54**, which is what
this project targets. If you ever see *"Project is incompatible with this
version of Expo Go"*, the project and the app have drifted apart; check
`expo` in `package.json` against
<https://expo.dev/go>. Do not "fix" it by upgrading the project blindly.

### Shipping to the App Store, later

Expo Go is for development only. A real TestFlight or App Store build needs an
Apple Developer account ($99/year) and a build service:

```bash
npm install -g eas-cli
eas build --platform ios
```

Nothing in this repo has to change to do that — it is purely an account and
build-pipeline step, so it can wait.

---

## Working on the GUI

Routing is file-based: **a file's path under `src/app/` is its URL.** Adding a
screen means adding a file.

```
src/app/
  _layout.tsx              Root stack, theme, auth providers, splash
  index.tsx                Routes to /login or /home
  login.tsx                Real sign-in screen (email + password)
  +not-found.tsx           Fallback for unknown routes
  (tabs)/
    _layout.tsx            Home · Agenda · People · Community · Me
    home/                  Now/next, announcements, resource grid
    agenda/                Day tabs, track filters, search, session detail
    people/                Attendees / speakers / sponsors segments,
                            [uid] detail route
    community/             Posting, replies, reactions, [id] detail route
    me/                    Profile, my schedule, privacy, badge.tsx (check-in QR)
  messages/                Inbox + [threadId] — a header icon, deliberately
                            not a tab
```

The tab set mirrors Whova: **Home, Agenda, People, Community, Me**. Messages is
reached from a header icon with an unread badge rather than being a sixth tab.
Headers are hidden on every tab; turn one back on with `headerShown: true` in
that tab's `_layout.tsx`.

`(tabs)` is a **route group** — the parentheses mean it does not appear in the
URL.

**All five tabs are built and read real data from Firestore** — this is not a
shell anymore. What is *not* finished, precisely:

- **`users/{uid}` is not created on an ordinary sign-in** (a demo-mode ticket
  purchase does create one — see `apps/web/src/lib/app-account.ts`). The seed
  script writes 50 demo profiles, which is why the app looks complete as a
  seeded user. A first-time real attendee has no profile document yet, so their
  name and privacy switches silently fall back to defaults instead of erroring.
- **Offline does not work**, despite some comments in the codebase claiming it
  does. The Firebase JS SDK has no disk persistence on React Native, so the
  cache is memory-only — a cold start with no network renders nothing.
- **Push notifications are not implemented.** The `fcmTokens` subcollection and
  `PushTokenDoc` type exist; nothing writes to or reads from them yet, and push
  needs a development build anyway (Expo Go cannot receive it).
- Session Q&A and live polls render, but their vote/reply counters never move —
  they are meant to be maintained by Cloud Function triggers that do not exist
  yet (see [Firebase setup](#firebase-setup)).

To add a detail screen, drop an `[id].tsx` beside an `index.tsx` — the stack
layout is already there for it, and `[id]` is a dynamic segment read with
`useLocalSearchParams()`.

### Shared pieces

| File | What it is for |
| --- | --- |
| `src/constants/theme.ts` | Brand colours, spacing, radii. **Change colours here, nowhere else.** |
| `src/hooks/use-theme.ts` | `useTheme()` returns the palette for light or dark mode |
| `src/components/text.tsx` | Typography. `<Text variant="title" tone="secondary">` |
| `src/components/screen.tsx` | Standard screen wrapper with correct iOS insets |
| `src/components/card.tsx` | Rounded container for list rows |
| `src/components/avatar.tsx` | Initials circle, until real photos exist |
| `src/components/empty-state.tsx` | Shown when a real query returns nothing |
| `src/lib/data/*` | One data-fetching hook per domain, all built on the same error-safe Firestore listener |

Every screen uses `useTheme()` rather than hard-coded colours, so dark mode
needs no per-screen work.

### Tab bar icons

The tabs use `NativeTabs`, which renders a **real UIKit tab bar** rather than a
JavaScript imitation, so it inherits system behaviour and appearance. Icons are
SF Symbols, set by name in `src/app/(tabs)/_layout.tsx`:

```tsx
import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';

<NativeTabs.Trigger name="attendees">
  <Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} />
  <Label>Attendees</Label>
</NativeTabs.Trigger>
```

To add an unread badge, import `Badge` alongside `Icon` and `Label` and drop a
`<Badge>12</Badge>` inside the Trigger.

**Every icon must be given twice**, because the platforms use different icon
systems. `sf` is SF Symbols and is iOS-only; `androidSrc` covers Android:

```tsx
<Icon
  sf={{ default: 'house', selected: 'house.fill' }}
  androidSrc={<VectorIcon family={MaterialIcons} name="home" />}
/>
```

Supplying only `sf` leaves Android with labels and no icons at all. Browse iOS
names in Apple's free **SF Symbols** app, and Android names at
<https://icons.expo.fyi>. The `sf` prop is typed against a union of every valid
symbol name, so a typo is a compile error rather than a blank icon.

Note this is the **SDK 54** API: `Icon` and `Label` are top-level imports. SDK
55+ moves them to `NativeTabs.Trigger.Icon` / `.Label`. Worth knowing if you
follow a newer tutorial.

---

## Demo login

Auth is real — this is genuine Firebase Authentication, not a hard-coded
check. `src/config/demo.ts` and `src/lib/auth/demo-auth.tsx` (the old
string-comparison stand-in) have been deleted.

What is still temporary is the **sign-in method**: the login screen takes an
email + password and checks them against the Auth **emulator**, because the
production design — a 6-digit code, requested and verified through a Cloud
Function (no password to remember, no deep-link setup) — needs the project on
the Blaze plan to deploy. See [Firebase setup](#firebase-setup).

To get a working local account, run against the emulator (see below), then
from the repo root:

```bash
npm run claims -- --emulator
```

This creates the 50 seeded demo accounts and stamps each with the
`registered` / `roles` custom claims that `firestore.rules` checks — the same
claims a `verifyOtp` Cloud Function will set automatically in production. The
shared local demo password is `kgcdemo2027`. Without running this once, seeded
Firestore documents exist but there is no Auth account allowed to read them.

---

## Firebase setup

The app runs without Firebase configured — `isFirebaseConfigured()` returns
`false` and the app renders a browsable "design mode" instead of trapping you
on the login screen. Connect it when you are ready for real data.

**For local development, use the emulator — this is the normal path and needs
no credentials or paid plan:**

1. From the repo root: `npm run dev:emulators` (needs the Firebase CLI and a
   JRE — the emulator runs on Java). Leave this running.
2. In another terminal, seed data and create demo accounts:
   ```bash
   export FIRESTORE_EMULATOR_HOST=localhost:8080
   export FIREBASE_AUTH_EMULATOR_HOST=localhost:9099
   npm run seed
   npm run claims -- --emulator
   ```
3. In `app/.env.local` (copy from `app/.env.example`), set
   `EXPO_PUBLIC_USE_EMULATOR=1`. On a physical device, also set
   `EXPO_PUBLIC_EMULATOR_HOST` to your computer's LAN IP — `localhost` on a
   phone resolves to the phone itself.
4. Restart with a cleared cache: `npm start -- -c`. Env vars are compiled into
   the bundle, so a plain restart is not enough.

**To connect the real `kgc-conference-app-and-website` project instead** (for anything beyond
local development):

1. Get the six `EXPO_PUBLIC_FIREBASE_*` values from Firebase console → Project
   settings → Your apps, and put them in `app/.env.local`.
2. The security rules and indexes are **already deployed** to that project as of
   2026-08-28 — rules, 16 composite indexes, 6 field overrides. Re-publish after
   changing them with `node scripts/ops/deploy-rules.mjs` and
   `node scripts/ops/deploy-indexes.mjs`; ⚠️ `firebase deploy` does not work
   here, it is refused with a `serviceusage` 403.
3. Leave `EXPO_PUBLIC_USE_EMULATOR` unset or `0`.

`EXPO_PUBLIC_*` values are embedded in the app bundle. That is expected for
Firebase — access control comes from `firestore.rules`, not from hiding them.

### The registration gate

A native app has no server of its own, so ticket-holder gating lives in
`firestore.rules` as `isRegistered()`. It checks the **`registered` custom
claim on the ID token** — not a document lookup, which is what an earlier
version did. Being signed in is not enough: anyone can create a Firebase
account, but the claim is only minted for people who bought a ticket
(`registrations`).

**Nothing mints that claim automatically yet.** `npm run claims` is a manual,
laptop-run stand-in for the `verifyOtp` Cloud Function that will eventually do
this at the moment of real sign-in. Until that function exists, a real
attendee who was never run through `npm run claims` can sign in but will fail
every rule that checks `isRegistered()`.

---

## Data model

Every Firestore document shape is typed in `src/types/models.ts`, and collection
names are centralised in `src/lib/firebase/collections.ts` so they are never
spelled out as string literals.

**Top-level:** `registrations`, `users`, `sessions`, `speakers`, `sponsors`,
`tracks`, `threads`, `communityPosts`, `announcements`.

**Subcollections:** `users/{uid}/savedSessions`, `savedContacts`,
`notifications`, `fcmTokens`; `sessions/{id}/questions` and `/polls`;
`threads/{id}/messages`; `communityPosts/{id}/replies`; `sponsors/{id}/leads`.

Two decisions worth knowing:

- **Thread IDs are deterministic** — the two participant uids sorted and joined
  with `_`, so a pair of attendees always maps to exactly one conversation.
- **Sessions carry a denormalised `day` string** (`YYYY-MM-DD` in Eastern Time)
  alongside real timestamps, so day tabs query by equality rather than computing
  timezone-aware ranges on every read.

Nine composite indexes are declared in `firestore.indexes.json`.

---

## Commands

| Command | What it does |
| --- | --- |
| `npx expo start` | Dev server + QR code |
| `npx expo start -c` | Same, clearing the Metro cache (use after env changes) |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm run deploy:rules` | Push Firestore rules, indexes and Storage rules |

---

## Known gaps

*Last checked against the code on **2026-08-28**, by running the checks rather
than by editing the previous version of this list. `ROADMAP.md` is the
project-wide measurement; this list is the app-side subset plus the things that
cut across everything. This project has a recurring problem with docs describing
capabilities the code doesn't have yet — and, lately, the reverse, so verify
before trusting either direction.*

### Closed since the last revision

- ✅ **Security rules and indexes are live** on `kgc-conference-app-and-website`
  — rules, 16 composite indexes, 6 field overrides. Pushed with
  `scripts/ops/deploy-rules.mjs` and `deploy-indexes.mjs`, because the Firebase
  CLI is refused on this project with a `serviceusage` 403.
- ✅ **The Cloud Function triggers exist.** Eight of them in
  `functions/src/triggers/`, 14 passing tests against the emulator. They are not
  *deployed* — that needs Blaze — but "functions/ is empty" is no longer true.
- ✅ **The organizer dashboard is not the least-finished part any more.** All
  **173** screens read or write real data; `npm run smoke` proves it.
  `apps/console/`, its predecessor, was deleted in August 2026.
- ✅ **A ticket purchase provisions the account that signs into the app** — Auth
  user, `users/{uid}`, `directory/{uid}`, `registered` claim. **Demo mode only**:
  it sets a publicly printed shared password, which is fine for invented
  attendees and a total compromise of real ones. See
  `apps/web/src/lib/app-account.ts`.

### Still open

- **`users/{uid}` is not created on an ordinary sign-in.** Seeded accounts and
  demo-mode purchases have a profile document; nothing else does. See
  [Working on the GUI](#working-on-the-gui).
- **Nothing mints the `registered` claim automatically outside that path.**
  `npm run claims` is still the manual stand-in. See
  [The registration gate](#the-registration-gate).
- **Offline does not work**, despite some in-code comments claiming it does.
  Needs the `@react-native-firebase/*` migration (no disk persistence in the
  Firebase JS SDK on React Native).
- **Push notifications are not implemented.** Nothing imports
  `expo-notifications`; `fcmTokens` is modelled and never read.
- **The project is still on Spark, so the triggers are not deployed** — which is
  why Session Q&A and poll counters and the `directory/{uid}` mirror do not move
  in production. Blaze's free quotas equal Spark's; this is a card on file.
- **Nothing uploads a file.** `storage.rules` exists with no writer, and unlike
  the Firestore rules it has not been published — `deploy-rules.mjs` targets
  `cloud.firestore` only.
- **No live Stripe transaction has ever been run.** The money path is built,
  tested and verified against the emulator, but the webhook has never received a
  real event. `SETUP-PAYMENTS.md` §4 closes that in about ten minutes and should
  happen before any real money does.
- **App icon and splash are still Expo's defaults**, in `assets/images/`.
- **`src/types/firebase-auth-rn.d.ts`** patches a missing type in the Firebase
  SDK. Delete it once firebase-js-sdk fixes its export map.
