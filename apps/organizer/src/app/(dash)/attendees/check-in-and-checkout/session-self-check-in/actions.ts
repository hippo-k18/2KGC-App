'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { COLLECTIONS } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { appendAudit } from '@/lib/audit';
import { ensureSessionList } from '@/lib/checkin';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';

export interface RoomDoorState {
  error?: string;
}

/**
 * Open a room door and hand back a kiosk pointed at it.
 *
 * Two things already existed and this joins them: `ensureSessionList` derives a
 * `checkInLists` document id from the session — so two organizers pressing this
 * open one door rather than two half-populated counts of the same room — and
 * the kiosk is the scanner with the operator's half removed. A room door is the
 * combination: an unattended station whose list is a session.
 *
 * The station is named after the room rather than the session, because that is
 * what is written on the door somebody is standing outside. Where the session
 * has no room recorded, the session's own title is the next most useful name a
 * duplicate-scan message can print.
 */
export async function openRoomDoorAction(
  _prev: RoomDoorState,
  formData: FormData,
): Promise<RoomDoorState> {
  const actor = await requireOrganizer();

  const sessionId = String(formData.get('sessionId') ?? '').trim();
  const station = String(formData.get('station') ?? '').trim();
  if (!sessionId) return { error: 'Pick the session this door counts people into.' };

  let listId: string;
  try {
    const list = await ensureSessionList(sessionId);
    listId = list.id;
    if (list.created) {
      await appendAudit({
        actor,
        action: 'checkinList.create',
        targetPath: `${COLLECTIONS.checkInLists}/${list.id}`,
        targetId: list.id,
        before: {},
        after: { name: list.name, kind: 'session', sessionId },
      });
    }
  } catch (err) {
    recordError('roomDoor.open', err);
    return { error: err instanceof Error ? err.message : 'Could not open that room door.' };
  }

  revalidatePath(ROUTES.checkIn);
  revalidatePath(ROUTES.analyticsExports);
  revalidatePath('/attendees/check-in-and-checkout/session-self-check-in');

  // Outside the try: `redirect()` works by throwing, so catching around it would
  // swallow the navigation and report it as a failure.
  redirect(
    `/attendees/check-in-and-checkout/kiosk-check-in?list=${encodeURIComponent(listId)}${
      station ? `&station=${encodeURIComponent(station)}` : ''
    }`,
  );
}
