import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  getReactNativePersistence,
  initializeAuth,
  type Auth,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

/**
 * Firebase is initialised lazily. Nothing here runs at import time, so the app
 * still boots (and shows a useful error) when `.env.local` has not been filled
 * in yet, instead of crashing during the first render.
 *
 * These `EXPO_PUBLIC_*` values are compiled into the app bundle. That is
 * expected for Firebase — access control comes from Firestore security rules,
 * not from keeping the config secret.
 */

const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

/**
 * Point the app at the local Firestore emulator instead of the real project.
 *
 * Set `EXPO_PUBLIC_USE_EMULATOR=1` in `.env.local` and the app reads the data
 * that `npm run seed` writes — 72 sessions, offline, free, no service-account
 * key and no Blaze plan. This is the normal way to develop screens; without it
 * every UI change needs production credentials and a seeded live database.
 *
 * `localhost` is wrong on a physical device: the phone resolves it to itself,
 * not to your Mac. Set `EXPO_PUBLIC_EMULATOR_HOST` to your machine's LAN address
 * when running in Expo Go on real hardware.
 */
const useEmulator = process.env.EXPO_PUBLIC_USE_EMULATOR === '1';
const emulatorHost = process.env.EXPO_PUBLIC_EMULATOR_HOST || 'localhost';

/**
 * True once the Firebase project details are present.
 *
 * The emulator does not check credentials, so a placeholder config is enough to
 * work against it — which means UI work can start before the real project is
 * provisioned.
 */
export function isFirebaseConfigured() {
  return useEmulator || Boolean(config.apiKey && config.projectId && config.appId);
}

function firebaseApp(): FirebaseApp {
  if (getApps().length) return getApp();
  if (!isFirebaseConfigured()) {
    throw new Error(
      'Missing Firebase config. Copy .env.example to .env.local, fill in the ' +
        'EXPO_PUBLIC_FIREBASE_* values, then restart with `npx expo start -c`.',
    );
  }
  return initializeApp({
    ...config,
    // The emulator ignores these but the SDK still requires them to be present.
    projectId: config.projectId || 'kgc-database',
    apiKey: config.apiKey || 'emulator',
    appId: config.appId || 'emulator',
  } as Required<typeof config>);
}

export function getFirebaseApp(): FirebaseApp {
  return firebaseApp();
}

/**
 * `initializeAuth` is used rather than `getAuth` so sessions persist to
 * AsyncStorage — without it the user is signed out every time the app restarts.
 * It throws if called twice, which Fast Refresh will do, hence the fallback.
 */
export function getFirebaseAuth(): Auth {
  const app = firebaseApp();
  let auth: Auth;
  try {
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    auth = getAuth(app);
  }
  // Same Fast Refresh hazard as Firestore above — see `emulatorState`.
  if (useEmulator && !emulatorState.__kgcAuthEmulator) {
    emulatorState.__kgcAuthEmulator = true;
    connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
  }
  return auth;
}

/**
 * Emulator connection state, parked on `globalThis` rather than in a module
 * variable.
 *
 * `connectFirestoreEmulator` throws "Firestore has already been started" if it
 * runs after the instance has issued a request. Fast Refresh re-evaluates this
 * module while the Firebase app — and its Firestore instance — survive, so a
 * module-level boolean resets to `false` and the second call crashes the app on
 * the next save. `globalThis` outlives the module.
 */
const emulatorState = globalThis as typeof globalThis & {
  __kgcFirestoreEmulator?: boolean;
  __kgcAuthEmulator?: boolean;
};

export function getDb(): Firestore {
  const store = getFirestore(firebaseApp());
  if (useEmulator && !emulatorState.__kgcFirestoreEmulator) {
    emulatorState.__kgcFirestoreEmulator = true;
    connectFirestoreEmulator(store, emulatorHost, 8080);
    console.log(`[firebase] Firestore emulator at ${emulatorHost}:8080`);
  }
  return store;
}

export function getFirebaseStorage(): FirebaseStorage {
  return getStorage(firebaseApp());
}
