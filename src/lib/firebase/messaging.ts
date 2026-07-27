import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDb, getFirebaseApp } from "@/lib/firebase/client";
import { COLLECTIONS, SUBCOLLECTIONS } from "@/lib/firebase/collections";

/**
 * Web push via FCM. Requires `public/firebase-messaging-sw.js` to be served
 * from the origin root, which is why it lives in `public/` rather than here.
 */

export async function pushSupported() {
  return typeof window !== "undefined" && (await isSupported());
}

/**
 * Asks for notification permission and stores the resulting token against the
 * user. Call this from a click handler — browsers reject unprompted requests.
 */
export async function registerForPush(uid: string) {
  if (!(await pushSupported())) return null;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  const registration = await navigator.serviceWorker.register(
    "/firebase-messaging-sw.js",
  );

  const token = await getToken(getMessaging(getFirebaseApp()), {
    vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  if (!token) return null;

  await setDoc(
    doc(getDb(), COLLECTIONS.users, uid, SUBCOLLECTIONS.fcmTokens, token),
    { token, userAgent: navigator.userAgent, createdAt: serverTimestamp() },
    { merge: true },
  );

  return token;
}

/** Foreground messages; background ones are handled by the service worker. */
export async function onPushMessage(handler: Parameters<typeof onMessage>[1]) {
  if (!(await pushSupported())) return () => {};
  return onMessage(getMessaging(getFirebaseApp()), handler);
}
