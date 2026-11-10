import 'server-only';

import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type SpeakerDoc, type SpeakerProfileEditDoc } from '@kgc/shared';
import { limitId, perHourAndDay, takeAllowance } from '@kgc/scripts/src/lib/rate-limit';
import { portalLinkOpens } from '@kgc/scripts/src/lib/speaker-portal-core';
import { readSpeakerToken } from '@kgc/scripts/src/lib/speaker-token';
import { db } from './firestore';
import { SPEAKER_PHOTO_CAPS } from './speaker-photo-core';

/**
 * The speaker a link belongs to, when the link may still act, or null.
 *
 * The same check as the website's `openPortal` (`apps/web/src/lib/speaker-portal.ts`):
 * the signature and its 180 days, the organizer's "Revoke link" stamp, and the
 * speaker still being on this event. One null for every failure, so the
 * endpoint answers "is this person still speaking?" to nobody.
 */
export async function speakerForPhotoUpload(rawToken: string): Promise<string | null> {
  const payload = readSpeakerToken(rawToken);
  if (!payload) return null;
  const [speakerSnap, editSnap] = await Promise.all([
    db().collection(COLLECTIONS.speakers).doc(payload.sid).get(),
    db().collection(COLLECTIONS.speakerProfileEdits).doc(payload.sid).get(),
  ]);
  if (!speakerSnap.exists) return null;
  const speaker = speakerSnap.data() as SpeakerDoc;
  const edit = editSnap.data() as SpeakerProfileEditDoc | undefined;
  const opens = portalLinkOpens({
    iat: payload.iat,
    linksValidFrom: edit?.linksValidFrom,
    speakerEventId: speaker.eventId,
    eventId: EVENT_ID,
  });
  return opens ? payload.sid : null;
}

/**
 * One upload counted against the link and the address, or false when either
 * is full. Fails closed, like every other caller of `takeAllowance`: a store
 * that cannot count is a store that should not take a file either.
 */
export async function photoUploadAllowed(speakerId: string, ip: string | undefined): Promise<boolean> {
  const speakerKey = `lim_speakerPhoto_speaker_${createHash('sha256').update(speakerId).digest('hex').slice(0, 24)}`;
  return takeAllowance(db() as unknown as Firestore, [
    { id: speakerKey, kind: 'speaker-photo-speaker', caps: perHourAndDay(...SPEAKER_PHOTO_CAPS.perSpeaker) },
    { id: ip ? limitId('speakerPhoto', 'ip', ip) : undefined, kind: 'speaker-photo-ip', caps: perHourAndDay(...SPEAKER_PHOTO_CAPS.perIp) },
  ]);
}
