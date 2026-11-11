import 'server-only';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type SpeakerContactDoc, type SpeakerDoc } from '@kgc/shared';
import { db } from './firestore';

/**
 * Speaker email addresses, kept off the attendee-readable `speakers` record
 * (T252, from T250 F3). Every read falls back to the legacy
 * `SpeakerDoc.contactEmail`, which nothing writes any more, so a record from
 * before the move is not suddenly without an address.
 */

const ref = (speakerId: string) => db().collection(COLLECTIONS.speakerContacts).doc(speakerId);

/** Every speaker's address for this event, by speaker id. */
export async function speakerContacts(
  speakers?: { id: string; data: Pick<SpeakerDoc, 'contactEmail'> }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const s of speakers ?? []) if (s.data.contactEmail) out.set(s.id, s.data.contactEmail);
  const snap = await db().collection(COLLECTIONS.speakerContacts).where('eventId', '==', EVENT_ID).get();
  for (const d of snap.docs) {
    const c = d.data() as SpeakerContactDoc;
    if (c.email) out.set(d.id, c.email);
  }
  return out;
}

/** One speaker's address, or undefined. */
export async function speakerContact(speakerId: string, legacy?: string): Promise<string | undefined> {
  const c = (await ref(speakerId).get()).data() as SpeakerContactDoc | undefined;
  return c?.email || legacy || undefined;
}

/**
 * Set or clear a speaker's address. Also removes the legacy field from the
 * speaker record, so the address is never in the readable document.
 */
export async function setSpeakerContact(speakerId: string, email: string | undefined): Promise<void> {
  const clean = email?.trim().toLowerCase();
  if (clean) {
    await ref(speakerId).set({ eventId: EVENT_ID, speakerId, email: clean, updatedAt: Timestamp.now() });
  } else {
    await ref(speakerId).delete();
  }
  await db()
    .collection(COLLECTIONS.speakers)
    .doc(speakerId)
    .update({ contactEmail: FieldValue.delete() })
    .catch(() => undefined);
}

/** Set an address only when the speaker has none yet. */
export async function ensureSpeakerContact(speakerId: string, email: string): Promise<void> {
  try {
    await ref(speakerId).create({
      eventId: EVENT_ID,
      speakerId,
      email: email.trim().toLowerCase(),
      updatedAt: Timestamp.now(),
    });
  } catch {
    // Already has one, or another accept wrote it a moment ago. Either way it is set.
  }
}
