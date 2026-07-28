# KGC — Knowledge Graph Conference app

A cross-platform conference app (a Whova alternative) for KGC 2026, built with
Expo and React Native. **Runs on both iPhone and Android** from one codebase.

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
npx expo start
```

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
npx expo start --tunnel
```

Slower, but it works across networks.

### Editing

Change any file under `src/`, save, and the phone reloads in about a second.
That live-reload loop is how the app gets built.

### Other ways to run it

| Command | What it does | Needs |
| --- | --- | --- |
| `npx expo start` then scan | Real phone via Expo Go | Expo Go, same Wi-Fi |
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
  index.tsx                Decides between /login and /home
  login.tsx                Demo sign-in screen
  +not-found.tsx           Fallback for unknown routes
  (tabs)/
    _layout.tsx            The five native tabs live here
    home/
      _layout.tsx
      index.tsx            blank
    agenda/
      _layout.tsx          Stack, so future detail screens keep the tab bar
      index.tsx            blank
    attendees/
      _layout.tsx
      index.tsx            blank
    community/
      _layout.tsx
      index.tsx            blank
    messages/
      _layout.tsx
      index.tsx            blank
```

The tab set mirrors Whova: **Home, Agenda, Attendees, Community, Messages**.
Headers are hidden on every tab, so each screen is bare from the status bar
down to the tab bar. Turn one back on with `headerShown: true` in that tab's
`_layout.tsx`.

`(tabs)` is a **route group** — the parentheses mean it does not appear in the
URL.

**Every tab is intentionally blank.** Each renders only the words
`KGC WHOVA DEMO`, from `src/components/demo-screen.tsx`. Navigation, theming,
the data model and the security rules are all in place; no feature UI has been
built yet. To start a screen, replace `<DemoScreen />` in that tab's
`index.tsx`.

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
| `src/components/card.tsx` | Rounded container for list rows. Unused while tabs are blank |
| `src/components/avatar.tsx` | Initials circle, until real photos exist. Unused for now |
| `src/components/empty-state.tsx` | Placeholder for screens with no data yet |
| `src/components/demo-screen.tsx` | The blank `KGC WHOVA DEMO` screen every tab currently renders |

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

The app opens on a sign-in screen. Use:

| | |
| --- | --- |
| Username | `demo@kgc.tech` |
| Password | `kgc2026` |

The credentials are also printed on the login screen itself, so nobody
demonstrating the app has to remember them.

**This is not real authentication.** It is a string comparison against
`src/config/demo.ts`. There is no server, no verification and no security —
anyone can read the credentials straight out of the app bundle.

The session is held in memory and **deliberately not persisted**, so every
reload and every fresh launch returns to the login screen. That keeps the
sign-in flow repeatable when demonstrating the app. There is no sign-out
control; reloading is the way back.

To remove the demo login once Firebase Auth is wired up, delete
`src/config/demo.ts` and `src/lib/auth/demo-auth.tsx`, then point
`src/app/index.tsx` at the real `useAuth()` from
`src/lib/auth/auth-provider.tsx`.

---

## Firebase setup

The app runs without Firebase — it starts with the demo login and blank tabs,
which is why you can browse the shell immediately. Connect it when you are
ready for real data.

1. Create a project at <https://console.firebase.google.com>.
2. Add a **Web app** (yes, web — the Firebase JS SDK is what runs inside React
   Native). Copy its config values.
3. `cp .env.example .env.local` and paste them in.
4. Restart with a cleared cache: `npx expo start -c`. Env vars are compiled into
   the bundle, so a plain restart is not enough.
5. Authentication → Sign-in method → enable **Email/Password**, then enable
   **Email link (passwordless sign-in)** within it.
6. Firestore → create a database in **production mode**.
7. Deploy the rules: `npm run deploy:rules`.
8. Import your ticket list into the `registrations` collection, keyed by
   lowercased email, before anyone tries to sign in.

`EXPO_PUBLIC_*` values are embedded in the app bundle. That is expected for
Firebase — access control comes from `firestore.rules`, not from hiding them.

### Auth is not finished

`src/app/login.tsx` is the real screen, but its submit button is not yet wired
to Firebase. Passwordless email links need deep linking configured on a native
build (an `applinks:` associated domain), which cannot be tested in Expo Go.
Decide between:

- **Email link** — matches the plan, best experience, needs deep-link setup.
- **6-digit code** — no deep linking, easy in Expo Go, needs a Cloud Function.

### The registration gate moved

The earlier web build checked the ticket list in a server route using the
Firebase Admin SDK. A native app has no server, so that check now lives in
`firestore.rules` as `isRegistered()`, which looks the signed-in user's email up
in `registrations`. Being signed in is not enough — anyone can create a Firebase
account, but only ticket holders appear on that list.

The trade-off is one extra document lookup per rule evaluation. When you add
Cloud Functions, set a custom claim at first sign-in and check
`request.auth.token.registered` instead.

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

- **Auth is not wired.** See above.
- **No feature UI.** Every tab is a blank `KGC WHOVA DEMO` screen by design, and
  nothing reads from Firestore yet.
- **Push notifications not implemented.** `PushTokenDoc` and the `fcmTokens`
  subcollection exist, but nothing writes to them. Note that push cannot be
  tested in Expo Go — it needs a development build.
- **No rules tests.** `firestore.rules` is the entire security boundary and is
  currently unverified. `@firebase/rules-unit-testing` against the emulator is
  the natural next step.
- **App icon and splash are still Expo's defaults**, in `assets/images/`.
- **`src/types/firebase-auth-rn.d.ts`** patches a missing type in the Firebase
  SDK. Delete it once firebase-js-sdk fixes its export map.
