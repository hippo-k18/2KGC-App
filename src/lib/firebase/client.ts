import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

/**
 * Client SDK accessors.
 *
 * These are functions rather than eagerly-created constants so that importing
 * this module never initialises Firebase. Prerendering runs module code on the
 * server with no `NEXT_PUBLIC_*` values present, and an eager `initializeApp`
 * fails the build with `auth/invalid-api-key`. Resolving on first call defers
 * that to the browser, where the config is actually available.
 */
function firebaseApp(): FirebaseApp {
  if (getApps().length) return getApp();

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing Firebase web config. Copy .env.example to .env.local and fill " +
        "in the NEXT_PUBLIC_FIREBASE_* values.",
    );
  }

  return initializeApp({
    apiKey,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  });
}

export function getFirebaseApp(): FirebaseApp {
  return firebaseApp();
}

export function getFirebaseAuth(): Auth {
  return getAuth(firebaseApp());
}

export function getDb(): Firestore {
  return getFirestore(firebaseApp());
}

export function getFirebaseStorage(): FirebaseStorage {
  return getStorage(firebaseApp());
}
