'use server';

import { revalidatePath } from 'next/cache';
import { COLLECTIONS, EVENT_ID, SUBCOLLECTIONS, type PollDoc } from '@kgc/shared';
import { appendAudit } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';
import { getPoll, publishTally, republishIfLive } from '@/lib/polls';

const ROUTE = '/engagement/live-polling';

export interface PollState {
  ok?: boolean;
  message?: string;
  error?: string;
}

/**
 * Options are one per line, and their **ids never move**.
 *
 * A vote document stores `optionIds`, so an option's id is the only thing
 * joining an answer to a question. Renumbering on every save would silently
 * repoint every vote already cast — the same failure `survey-actions.ts` guards
 * against with its question ids, for the same reason. Ids are assigned by
 * position on the first save and reused by position afterwards, and the editor
 * refuses to reorder or remove an option once anybody has voted.
 */
function parseOptions(
  raw: string,
  existing: PollDoc['options'] | undefined,
): PollDoc['options'] | { error: string } {
  const labels = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (labels.length < 2) return { error: 'A poll needs at least two options, one per line.' };
  if (labels.length > 10) {
    return { error: 'Ten options is already more than an audience will read off a screen.' };
  }

  const seen = new Set<string>();
  for (const l of labels) {
    const key = l.toLowerCase();
    if (seen.has(key)) return { error: `“${l}” is listed twice.` };
    seen.add(key);
  }

  return labels.map((label, i) => ({ id: existing?.[i]?.id ?? `o${i + 1}`, label }));
}

export async function savePollAction(_prev: PollState, formData: FormData): Promise<PollState> {
  const actor = await requireOrganizer();

  const sessionId = String(formData.get('sessionId') ?? '').trim();
  const id = String(formData.get('id') ?? '').trim();
  const question = String(formData.get('question') ?? '').trim();
  const open = formData.get('open') === 'on';
  const liveResults = formData.get('liveResults') === 'on';
  const raw = String(formData.get('options') ?? '');

  if (!sessionId) return { error: 'Choose the session this poll belongs to.' };
  if (question.length < 3) return { error: 'Give the poll a question.' };

  try {
    const existing = id ? await getPoll(sessionId, id) : null;
    const parsed = parseOptions(
      raw,
      existing?.options.map((o) => ({ id: o.id, label: o.label })),
    );
    if ('error' in parsed) return { error: parsed.error };

    /**
     * Changing the options of a poll that has votes would repoint answers
     * already given: option `o2` becomes a different option and every vote
     * naming it still points at it. Relabelling is allowed — the ids are what
     * the votes hold, and a typo fixed mid-session should not cost the results.
     * Adding, removing or reordering is refused.
     */
    if (existing && existing.actualVotes > 0) {
      const before = existing.options.length;
      if (parsed.length !== before) {
        return {
          error:
            `${existing.actualVotes} ${existing.actualVotes === 1 ? 'person has' : 'people have'} ` +
            'already voted, so options cannot be added or removed. The votes already cast name ' +
            'these options by position. Relabelling one is fine; create a new poll for a different ' +
            'set of answers.',
        };
      }
    }

    const sessionRef = db().collection(COLLECTIONS.sessions).doc(sessionId);
    const ref = id
      ? sessionRef.collection(SUBCOLLECTIONS.polls).doc(id)
      : sessionRef.collection(SUBCOLLECTIONS.polls).doc();

    await ref.set(
      {
        eventId: EVENT_ID,
        question,
        options: parsed,
        open,
        /**
         * Written on every save, never left off. A checkbox that is not ticked
         * sends no key at all, and these stores run with
         * `ignoreUndefinedProperties` under `merge: true`, so a field omitted
         * on the write keeps its old value — an organizer who turns live
         * results off and is told "Saved" would still be republishing.
         */
        liveResults,
        /**
         * A new poll is seeded with an empty tally rather than left without
         * one: the app reads `tallies` and `totalVotes` directly, and a missing
         * map renders as a broken result rather than as a poll nobody has
         * answered. Neither field is maintained here — `publishTally()` writes
         * them when an organizer asks, and the `tallyPoll` trigger will when it
         * is deployed.
         */
        ...(existing ? {} : { tallies: {}, totalVotes: 0, createdAt: new Date() }),
      },
      { merge: true },
    );

    await appendAudit({
      actor,
      action: existing ? 'poll.update' : 'poll.create',
      targetPath: `${COLLECTIONS.sessions}/${sessionId}/${SUBCOLLECTIONS.polls}/${ref.id}`,
      targetId: ref.id,
      before: existing
        ? { question: existing.question, open: existing.open, liveResults: existing.liveResults }
        : {},
      after: { question, open, liveResults, options: parsed.length },
    });

    revalidatePath(ROUTE);

    return {
      ok: true,
      message: existing
        ? `Saved “${question}”.`
        : `Created “${question}” with ${parsed.length} options${open ? ', open to votes now' : ' as a closed poll'}.`,
    };
  } catch (err) {
    recordError('poll.save', err);
    return { error: err instanceof Error ? err.message : 'Could not save the poll.' };
  }
}

/**
 * Open or close a poll. A form, never a link — it changes what attendees see,
 * and `firestore.rules` reads `open` on the vote-write path, so closing one
 * actually stops votes rather than merely hiding the question.
 */
export async function setPollOpenAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const sessionId = String(formData.get('sessionId') ?? '').trim();
  const id = String(formData.get('id') ?? '').trim();
  const open = String(formData.get('open') ?? '') === 'true';
  if (!sessionId || !id) return;

  try {
    const existing = await getPoll(sessionId, id);
    if (!existing) return;

    await db()
      .collection(COLLECTIONS.sessions)
      .doc(sessionId)
      .collection(SUBCOLLECTIONS.polls)
      .doc(id)
      .update({ open });

    await appendAudit({
      actor,
      action: 'poll.update',
      targetPath: `${COLLECTIONS.sessions}/${sessionId}/${SUBCOLLECTIONS.polls}/${id}`,
      targetId: id,
      before: { open: existing.open },
      after: { open },
    });
  } catch (err) {
    recordError('poll.setOpen', err);
  }
  revalidatePath(ROUTE);
}

/**
 * Turn live results on or off for one poll.
 *
 * Switching it on publishes the count straight away. Waiting for the room view's
 * first tick would leave the app showing the old number for as long as it took
 * somebody to open the projector page, and the organizer who just pressed this
 * has every reason to think it took effect.
 */
export async function setLiveResultsAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const sessionId = String(formData.get('sessionId') ?? '').trim();
  const id = String(formData.get('id') ?? '').trim();
  const liveResults = String(formData.get('liveResults') ?? '') === 'true';
  if (!sessionId || !id) return;

  try {
    const existing = await getPoll(sessionId, id);
    if (!existing) return;

    await db()
      .collection(COLLECTIONS.sessions)
      .doc(sessionId)
      .collection(SUBCOLLECTIONS.polls)
      .doc(id)
      .update({ liveResults });

    if (liveResults) await publishTally(sessionId, id);

    await appendAudit({
      actor,
      action: 'poll.update',
      targetPath: `${COLLECTIONS.sessions}/${sessionId}/${SUBCOLLECTIONS.polls}/${id}`,
      targetId: id,
      before: { liveResults: existing.liveResults },
      after: { liveResults },
    });
  } catch (err) {
    recordError('poll.setLiveResults', err);
  }
  revalidatePath(ROUTE);
}

/**
 * One beat of the room view's timer.
 *
 * Called from the browser on an interval rather than from the page render: a
 * server component that wrote on every GET would republish a tally because
 * somebody refreshed a tab, and a prefetch would do it unasked. This is a POST,
 * it re-reads `liveResults` before writing anything, and it returns the figure
 * it left behind so the projector page can say when it last moved.
 */
export async function tickRoomViewAction(
  sessionId: string,
  pollId: string,
): Promise<{ published: boolean; total: number }> {
  await requireOrganizer();
  if (!sessionId || !pollId) return { published: false, total: 0 };

  try {
    return await republishIfLive(sessionId, pollId);
  } catch (err) {
    recordError('poll.tickRoomView', err);
    return { published: false, total: 0 };
  }
}

/**
 * Count the votes and write the result into the fields attendees' phones read.
 *
 * This is the honest substitute for the undeployed `tallyPoll` trigger. It is a
 * snapshot, not a live tally: the number in the app is correct as of the moment
 * somebody pressed this, and the dashboard goes on counting the vote documents
 * on every load regardless.
 */
export async function publishTallyAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const sessionId = String(formData.get('sessionId') ?? '').trim();
  const id = String(formData.get('id') ?? '').trim();
  if (!sessionId || !id) return;

  try {
    const before = await getPoll(sessionId, id);
    const written = await publishTally(sessionId, id);

    await appendAudit({
      actor,
      action: 'poll.publishTally',
      targetPath: `${COLLECTIONS.sessions}/${sessionId}/${SUBCOLLECTIONS.polls}/${id}`,
      targetId: id,
      before: { totalVotes: before?.storedTotal ?? 0 },
      after: { totalVotes: written.total },
    });
  } catch (err) {
    recordError('poll.publishTally', err);
  }
  revalidatePath(ROUTE);
}
