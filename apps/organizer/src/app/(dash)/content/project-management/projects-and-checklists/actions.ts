'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { appendAudit, diff } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';
import { getTask, nextStatus, type TaskStatus } from '@/lib/planning';

/**
 * Creating, editing and advancing the organizing team's own checklist.
 *
 * ── This is the one screen that is not about attendees ──────────────────────
 *
 * Nothing here reaches an attendee's phone. That lowers the blast radius of a
 * mistake enormously compared with the ticket or session screens, and it is why
 * this file has far less validation than `1-1-create-tickets/actions.ts`: the
 * worst outcome of a bad row is that somebody has to fix a typo, not that a card
 * is charged the wrong amount.
 *
 * It is still audited. Six people share a checklist, and "who marked the AV
 * booking done?" is the question that gets asked at 08:00 on day one when the
 * AV company has not arrived.
 *
 * ── `assignee` is free text, and that is the model's decision ───────────────
 *
 * `TaskDoc.assignee` is a name, not a uid, because half the people on a
 * conference checklist are volunteers and suppliers who will never hold an
 * account. So there is no picker here and no validation against `users` — a
 * dropdown would exclude exactly the people the list exists to chase.
 */

/**
 * `ROUTES` in `lib/nav.ts` has no entry for this screen and that file belongs to
 * another work package in flight, so the path is spelled once here rather than
 * three times inline.
 */
const PATH = '/content/project-management/projects-and-checklists';

export interface TaskState {
  ok?: boolean;
  message?: string;
  error?: string;
}

const STATUSES: TaskStatus[] = ['todo', 'doing', 'done', 'blocked'];

function parseStatus(raw: string): TaskStatus | null {
  return (STATUSES as string[]).includes(raw) ? (raw as TaskStatus) : null;
}

/**
 * `YYYY-MM-DD` or nothing.
 *
 * Kept as a plain string end to end — `TaskDoc.dueOn` is typed that way, and a
 * checklist deadline is a calendar day rather than an instant. Converting it to
 * a `Timestamp` would put "book the AV company" on the wrong day for anyone
 * whose browser is not on the venue's clock.
 */
function parseDueOn(raw: string): string | null | undefined {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : raw;
}

export async function saveTaskAction(_prev: TaskState, formData: FormData): Promise<TaskState> {
  const actor = await requireOrganizer();

  const id = String(formData.get('id') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const project = String(formData.get('project') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim();
  const assignee = String(formData.get('assignee') ?? '').trim();
  const dueRaw = String(formData.get('dueOn') ?? '').trim();
  const statusRaw = String(formData.get('status') ?? 'todo').trim();
  const orderRaw = Number(formData.get('order') ?? 0);

  if (title.length < 2) return { error: 'Give the task a title.' };
  if (project.length < 2) {
    return { error: 'Every task belongs to a project — that is how the list groups.' };
  }

  const status = parseStatus(statusRaw);
  if (!status) return { error: 'Status must be todo, doing, done or blocked.' };

  const dueOn = parseDueOn(dueRaw);
  if (dueOn === undefined) return { error: 'The due date must be a real date, or blank.' };

  const existing = id ? await getTask(id) : null;
  if (id && !existing) return { error: 'That task no longer exists — somebody may have removed it.' };

  try {
    const ref = id
      ? db().collection(COLLECTIONS.tasks).doc(id)
      : db().collection(COLLECTIONS.tasks).doc();

    /**
     * `completedAt` and `completedBy` are set here rather than left to a
     * trigger, because the triggers this project would use need the Blaze plan
     * and do not exist. They are cleared whenever the task leaves `done` — a
     * reopened task that still carries a completion stamp reads as finished in
     * every export that touches those two fields.
     */
    const completing = status === 'done';
    const wasDone = existing?.status === 'done';

    await ref.set(
      {
        title,
        project,
        notes,
        assignee,
        /**
         * `delete()` rather than `undefined`. The store runs with
         * `ignoreUndefinedProperties`, so an undefined field is simply omitted
         * from a merging write — which means clearing a due date would silently
         * leave the old one in place.
         */
        dueOn: dueOn ?? FieldValue.delete(),
        status,
        order: Number.isFinite(orderRaw) ? orderRaw : 0,
        completedAt: completing
          ? // Keep the original completion time when the task was already done
            // and this edit only changed the wording.
            (wasDone ? existing?.completedAt : undefined) ?? FieldValue.serverTimestamp()
          : FieldValue.delete(),
        completedBy: completing ? (wasDone ? existing?.completedBy : undefined) ?? actor : FieldValue.delete(),
        eventId: EVENT_ID,
        ...(existing ? {} : { createdAt: FieldValue.serverTimestamp() }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const changed = diff(
      existing
        ? {
            title: existing.title,
            project: existing.project,
            assignee: existing.assignee,
            dueOn: existing.dueOn,
            status: existing.status,
          }
        : {},
      { title, project, assignee, dueOn, status },
    );

    await appendAudit({
      actor,
      action: existing ? 'task.update' : 'task.create',
      targetPath: `${COLLECTIONS.tasks}/${ref.id}`,
      targetId: ref.id,
      before: changed.before,
      after: changed.after,
    });

    revalidatePath(PATH);

    return {
      ok: true,
      message: existing ? 'Saved.' : `Added "${title}" to ${project}.`,
    };
  } catch (err) {
    recordError('task.save', err);
    return { error: err instanceof Error ? err.message : 'Could not save the task.' };
  }
}

/**
 * Move one task to the next status in a single click.
 *
 * **A form POST, never a link.** A GET that changes state is one prefetch away
 * from marking the entire checklist done: Next.js prefetches `<Link>` targets on
 * hover, and a crawler or a browser's link prefetcher does it without a hover at
 * all. The console has been careful about this once already — the ticket
 * visibility toggle is a form for the same reason — and this screen is the
 * version where the damage is silent, because nobody notices a checklist that
 * completed itself until they stop chasing the things on it.
 */
export async function advanceTaskAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return;

  const existing = await getTask(id);
  if (!existing) return;

  const from = existing.status ?? 'todo';
  const to = nextStatus(from);

  try {
    await db()
      .collection(COLLECTIONS.tasks)
      .doc(id)
      .update({
        status: to,
        completedAt: to === 'done' ? FieldValue.serverTimestamp() : FieldValue.delete(),
        completedBy: to === 'done' ? actor : FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });

    await appendAudit({
      actor,
      action: 'task.update',
      targetPath: `${COLLECTIONS.tasks}/${id}`,
      targetId: id,
      before: { status: from },
      after: { status: to },
    });
  } catch (err) {
    recordError('task.advance', err);
  }

  revalidatePath(PATH);
}
