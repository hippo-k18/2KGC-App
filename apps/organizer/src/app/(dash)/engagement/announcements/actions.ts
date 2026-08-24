'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type AnnouncementDoc } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { appendAudit } from '@/lib/audit';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';
import { announcementPush } from '@/lib/push';

export interface SendState {
  ok?: boolean;
  message?: string;
  error?: string;
  pushNote?: string;
}

/**
 * The most dangerous button in the product: it reaches every attendee and
 * cannot be recalled. Two guards, both cheap:
 *
 *  - an explicit confirmation checkbox, so "send" is never one stray click; and
 *  - a 60-second server-side cooldown, checked against the newest announcement
 *    rather than against anything in this process, so it survives a reload and
 *    a second browser tab.
 *
 * The research flags a 6am wrong-timezone blast as a common real failure. There
 * is no scheduling here at all, which is the cheapest possible defence: an
 * announcement goes out when a human presses the button, in the room, awake.
 */
const COOLDOWN_MS = 60_000;

export async function sendAnnouncementAction(
  _prev: SendState,
  formData: FormData,
): Promise<SendState> {
  const actor = await requireOrganizer();

  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const push = formData.get('push') === 'on';
  const confirmed = formData.get('confirm') === 'on';

  if (!title) return { error: 'Title is required.' };
  if (!body) return { error: 'Body is required.' };
  if (!confirmed) {
    return { error: 'Tick the confirmation box. This goes to every attendee and cannot be undone.' };
  }

  try {
    const latest = await db()
      .collection(COLLECTIONS.announcements)
      .where('eventId', '==', EVENT_ID)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    const last = latest.docs[0]?.data() as AnnouncementDoc | undefined;
    if (last?.createdAt) {
      const since = Date.now() - last.createdAt.toDate().getTime();
      if (since < COOLDOWN_MS) {
        return {
          error: `Last announcement was ${Math.round(since / 1000)}s ago. Wait ${Math.ceil(
            (COOLDOWN_MS - since) / 1000,
          )}s — a double-send is indistinguishable from spam on the receiving phone.`,
        };
      }
    }

    const now = FieldValue.serverTimestamp();
    const ref = await db()
      .collection(COLLECTIONS.announcements)
      .add({
        eventId: EVENT_ID,
        title,
        body,
        // The allowlisted organizer email stands in for a uid until SSO lands
        // and the console has a real Firebase Auth subject to record.
        authorId: actor,
        push,
        createdAt: now,
        updatedAt: now,
      });

    await appendAudit({
      actor,
      action: 'announcement.create',
      targetPath: `${COLLECTIONS.announcements}/${ref.id}`,
      targetId: ref.id,
      before: {},
      after: { title, body, push },
    });

    let pushNote: string | undefined;
    if (push) {
      pushNote = (await announcementPush({ announcementId: ref.id, title, body })).detail;
    }

    revalidatePath(ROUTES.announcements);
    revalidatePath(ROUTES.warRoom);

    return {
      ok: true,
      message: `Sent. Attendees on the announcements screen see it immediately (${ref.id}).`,
      pushNote,
    };
  } catch (err) {
    recordError('announcement.create', err);
    return { error: err instanceof Error ? err.message : 'Send failed.' };
  }
}
