'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { COLLECTIONS } from '@kgc/shared';
import { appendAudit } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';
import { removeFromSession, setSessionCap } from '@/lib/session-seats';
import { parseCap } from '@/lib/session-seats-core';
import type { FormState } from '../../form';

const SCREEN = '/attendees/session-cap';

function revalidate() {
  revalidatePath(SCREEN);
  revalidatePath('/attendees/ticket-session-mapping');
  revalidatePath(ROUTES.sessionManager, 'layout');
}

/**
 * Change a session's cap. Raising it seats as many of the waitlist as now fit,
 * in order, in the same transaction; lowering it removes nobody.
 */
export async function setCapAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireOrganizer();
  const sessionId = String(formData.get('sessionId') ?? '');
  if (!sessionId) return { error: 'Pick a session first.' };

  const parsed = parseCap(String(formData.get('capacity') ?? ''));
  if (!parsed.ok) return { fieldErrors: { capacity: parsed.error }, error: parsed.error };

  try {
    const out = await setSessionCap(sessionId, parsed.capacity, actor);
    if (!out.ok) return { error: out.error };

    await appendAudit({
      actor,
      action: 'session.update',
      targetPath: `${COLLECTIONS.sessions}/${sessionId}`,
      targetId: sessionId,
      before: { capacity: out.before ?? null },
      after: { capacity: parsed.capacity, promotedFromWaitlist: out.promoted.length },
    });
    revalidate();

    const cap = parsed.capacity === null ? 'Cap removed.' : `Cap set to ${parsed.capacity}.`;
    const moved = out.promoted.length;
    return {
      ok: true,
      message: moved
        ? `${cap} ${moved} ${moved === 1 ? 'person' : 'people'} moved from the waitlist into a seat.`
        : cap,
    };
  } catch (err) {
    recordError(`sessionSeats.setCap ${sessionId}`, err);
    return { error: 'The cap could not be saved. Try again.' };
  }
}

/**
 * Take one person out of a session. Their seat goes to the first person
 * waiting. Redirects back with the outcome, because the row this was pressed on
 * is gone once it has worked.
 */
export async function removeSeatAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const sessionId = String(formData.get('sessionId') ?? '');
  const uid = String(formData.get('uid') ?? '');
  const name = String(formData.get('name') ?? '');
  if (!sessionId || !uid) redirect(SCREEN);

  const back = new URLSearchParams({ session: sessionId });
  try {
    const out = await removeFromSession(sessionId, uid, actor);
    if (!out.ok) {
      back.set('error', out.error ?? 'That did not work.');
    } else {
      await appendAudit({
        actor,
        action: 'sessionSeat.remove',
        targetPath: `${COLLECTIONS.sessionSeats}/${sessionId}/seats/${uid}`,
        targetId: uid,
        before: { name },
        after: { promoted: out.promoted },
      });
      back.set('removed', name || 'Attendee');
      if (out.promoted.length) back.set('promoted', String(out.promoted.length));
    }
  } catch (err) {
    recordError(`sessionSeats.remove ${sessionId}/${uid}`, err);
    back.set('error', 'That person could not be removed. Try again.');
  }
  revalidate();
  redirect(`${SCREEN}?${back.toString()}`);
}
