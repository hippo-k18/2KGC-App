import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  getReactNativePersistence,
  initializeAuth,
  type Auth,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
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

/** True once the Firebase project details are present. */
export function isFirebaseConfigured() {
  return Boolean(config.apiKey && config.projectId && config.appId);
}

function firebaseApp(): FirebaseApp {
  if (getApps().length) return getApp();
  if (!isFirebaseConfigured()) {
    throw new Error(
      'Missing Firebase config. Copy .env.example to .env.local, fill in the ' +
        'EXPO_PUBLIC_FIREBASE_* values, then restart with `npx expo start -c`.',
    );
  }
  return initializeApp(config as Required<typeof config>);
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
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuth(app);
  }
}

export function getDb(): Firestore {
  return getFirestore(firebaseApp());
}

export function getFirebaseStorage(): FirebaseStorage {
  return getStorage(firebaseApp());
}
