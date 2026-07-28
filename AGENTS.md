# Working in this repo

Expo SDK 57 / React Native 0.86 / expo-router 57 / React 19.2. These are newer
than most training data. **Check the versioned docs at
<https://docs.expo.dev/versions/v57.0.0/> before using an API you have not
verified**, and prefer reading the installed type definitions in
`node_modules/` over recalling an older signature.

Things that commonly trip people up here:

- **Tabs are native.** `src/app/(tabs)/_layout.tsx` uses `NativeTabs` from
  `expo-router/unstable-native-tabs`, not the older JS `Tabs`. The API differs:
  children are `NativeTabs.Trigger` with `.Icon` / `.Label` / `.Badge`
  subcomponents. It is explicitly marked unstable and has changed between SDKs.
- **`ThemeProvider`, `DefaultTheme` and `DarkTheme` are imported from
  `expo-router`**, not from `@react-navigation/native`.
- **Routes live under `src/app/`**, not a top-level `app/`. Path aliases are
  `@/*` → `src/*` and `@/assets/*` → `assets/*`.
- **`getReactNativePersistence` is missing from `firebase/auth`'s types** but
  present at runtime. See `src/types/firebase-auth-rn.d.ts` for why, and do not
  "fix" it by adding `@firebase/auth` as a direct dependency — that risks two
  auth instances.
- **Env vars must be prefixed `EXPO_PUBLIC_`** to reach the app, and are baked
  into the bundle at build time. Restart with `npx expo start -c` after changing
  them.
- **Firebase is initialised lazily** in `src/lib/firebase/client.ts`. Keep it
  that way: eager initialisation crashes the app when `.env.local` is absent,
  instead of falling back to design mode.

Verify changes with `npm run typecheck`. To check that everything still bundles
without a device, run `npx expo export --platform ios`.
