# KGC — Knowledge Graph Conference app

A native iOS conference app (a Whova alternative) for KGC 2026, built with Expo
and React Native. Android comes along for free but iOS is the target.

---

## Viewing the app on your iPhone

This is the fastest path and needs no Xcode, no simulator download, and no
Apple Developer account.

1. Install **Expo Go** from the App Store on your iPhone.
2. Put the iPhone and this Mac on the **same Wi-Fi network**.
3. In this folder, run:

   ```bash
   npm install     # first time only
   npx expo start
   ```

4. A QR code appears in the terminal. Scan it with the iPhone **Camera** app and
   tap the banner. The app opens inside Expo Go.

Edit any file under `src/` and save — the phone updates in about a second. That
live-reload loop is how you work on the GUI.

If the QR code will not connect (common on corporate, guest, or locked-down
Wi-Fi), run it through a tunnel instead:

```bash
npx expo start --tunnel
```

### Other ways to run it

| Command | What it does | Needs |
| --- | --- | --- |
| `npx expo start` then scan | Real iPhone via Expo Go | Expo Go, same Wi-Fi |
| `npm run ios` | iOS Simulator on this Mac | Xcode **plus a downloaded simulator runtime** |
| `npm run web` | Opens in a browser — quickest for rough layout work | nothing |

Xcode 26 no longer bundles simulator runtimes. To use `npm run ios` you must
first open Xcode → Settings → Components and download an iOS runtime (several
GB). Expo Go on a real device is quicker and shows the truer result.

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
  _layout.tsx              Root stack, theme, auth provider, splash
  login.tsx                Sign-in screen (presented as a modal)
  +not-found.tsx           Fallback for unknown routes
  (tabs)/
    _layout.tsx            The five native tabs live here
    agenda/
      _layout.tsx          Stack, so detail screens keep the tab bar
      index.tsx            Agenda list + day selector
      [id].tsx             Session detail
    speakers/
      _layout.tsx
      index.tsx            Speaker list
      [id].tsx             Speaker detail
    community/index.tsx    Community board
    messages/index.tsx     Message inbox
    profile/index.tsx      Profile and sign-out
```

`(tabs)` is a **route group** — the parentheses mean it does not appear in the
URL. `[id]` is a dynamic segment, read with `useLocalSearchParams()`.

### Shared pieces

| File | What it is for |
| --- | --- |
| `src/constants/theme.ts` | Brand colours, spacing, radii. **Change colours here, nowhere else.** |
| `src/hooks/use-theme.ts` | `useTheme()` returns the palette for light or dark mode |
| `src/components/text.tsx` | Typography. `<Text variant="title" tone="secondary">` |
| `src/components/screen.tsx` | Standard screen wrapper with correct iOS insets |
| `src/components/card.tsx` | The rounded container used across every list |
| `src/components/avatar.tsx` | Initials circle, until real photos exist |
| `src/components/empty-state.tsx` | Placeholder for screens with no data yet |

Every screen uses `useTheme()` rather than hard-coded colours, so dark mode
needs no per-screen work.

### Tab bar icons

The tabs use `NativeTabs`, which renders a **real UIKit tab bar** rather than a
JavaScript imitation, so it inherits system behaviour and appearance. Icons are
SF Symbols, set by name in `src/app/(tabs)/_layout.tsx`:

```tsx
<NativeTabs.Trigger.Icon sf={{ default: 'calendar', selected: 'calendar' }} md="calendar_month" />
```

Browse names in Apple's free **SF Symbols** app.

### Sample data

`src/lib/sample-data.ts` is placeholder content so the screens render something
to design against. **Delete it once Firestore is connected.** Any screen showing
it says so on the screen itself.

---

## Firebase setup

The app runs without Firebase — it starts in "design mode" with sample data and
sign-in disabled, which is why you can browse the GUI immediately. Connect it
when you are ready for real data.

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
- **Sample data everywhere.** No screen reads from Firestore yet.
- **Push notifications not implemented.** `PushTokenDoc` and the `fcmTokens`
  subcollection exist, but nothing writes to them. Note that push cannot be
  tested in Expo Go — it needs a development build.
- **No rules tests.** `firestore.rules` is the entire security boundary and is
  currently unverified. `@firebase/rules-unit-testing` against the emulator is
  the natural next step.
- **App icon and splash are still Expo's defaults**, in `assets/images/`.
- **`src/types/firebase-auth-rn.d.ts`** patches a missing type in the Firebase
  SDK. Delete it once firebase-js-sdk fixes its export map.
