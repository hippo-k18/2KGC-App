import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  type DocumentDoc,
  type TaskDoc,
  type WithId,
} from '@kgc/shared';
import { db } from './firestore';

/**
 * Every read behind Project Management and Documents & Videos.
 *
 * Two collections in one module because they are the same shape of problem —
 * a small, organizer-authored list with an `order` field and a status — and
 * splitting them would mean two files that each hold one query.
 *
 * ── No composite index ──────────────────────────────────────────────────────
 *
 * Every query here is a single equality filter on `eventId` and sorts in
 * memory. `where(eventId) + orderBy(order)` needs a composite index; the
 * emulator does not enforce index configuration at all, so that query passes
 * every local run and fails in production with `failed-precondition`. Two
 * screens have already shipped broken this way on this project. A conference
 * checklist is tens of rows and a document list is dozens — sorting them in
 * Node costs nothing measurable and cannot fail.
 *
 * ── Timestamps do not leave this module ─────────────────────────────────────
 *
 * Rows are plain objects with ISO strings, so a page can hand one to a client
 * component without the Admin SDK's `Timestamp` class riding along and failing
 * serialisation at the boundary.
 */

function iso(t: { toDate(): Date } | undefined): string | undefined {
  try {
    return t?.toDate().toISOString();
  } catch {
    // One malformed timestamp must not take the whole checklist down.
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type TaskStatus = TaskDoc['status'];

/** The four statuses in the order a task moves through them. */
export const TASK_STATUSES: TaskStatus[] = ['todo', 'doing', 'done', 'blocked'];

export interface TaskRow {
  id: string;
  title: string;
  notes: string;
  project: string;
  assignee: string;
  /** `YYYY-MM-DD`, already a plain string on the document. */
  dueOn?: string;
  status: TaskStatus;
  order: number;
  completedAt?: string;
  completedBy?: string;
  /** Due, not done, and the date has passed. Computed here so the page cannot disagree with the form. */
  overdue: boolean;
}

export interface TaskProject {
  /** The `project` field verbatim — it is free text, and it is the group key. */
  name: string;
  tasks: TaskRow[];
  total: number;
  done: number;
  blocked: number;
  /** 0–100. `done / total`, which is what a checklist bar has to mean. */
  pct: number;
}

/** Today in the organizer's local terms. Overdue is a date comparison, not a clock one. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function toTaskRow(id: string, t: TaskDoc): TaskRow {
  const status = t.status ?? 'todo';
  const dueOn = t.dueOn || undefined;
  return {
    id,
    title: t.title,
    notes: t.notes ?? '',
    // A task with no project would vanish from a grouped view entirely, so it
    // gets a bucket rather than being dropped.
    project: (t.project ?? '').trim() || 'Unfiled',
    assignee: (t.assignee ?? '').trim(),
    dueOn,
    status,
    order: t.order ?? 0,
    completedAt: iso(t.completedAt),
    completedBy: t.completedBy,
    overdue: Boolean(dueOn) && status !== 'done' && dueOn! < today(),
  };
}

export async function listTasks(): Promise<TaskRow[]> {
  const snap = await db().collection(COLLECTIONS.tasks).where('eventId', '==', EVENT_ID).get();
  return snap.docs
    .map((d) => toTaskRow(d.id, d.data() as TaskDoc))
    .sort(
      (a, b) =>
        a.project.localeCompare(b.project) || a.order - b.order || a.title.localeCompare(b.title),
    );
}

export async function getTask(id: string): Promise<WithId<TaskDoc> | null> {
  const doc = await db().collection(COLLECTIONS.tasks).doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() as TaskDoc;
  // The console is single-event, but a shared database is not, and a stray id
  // must not become an edit against somebody else's conference.
  if (data.eventId !== EVENT_ID) return null;
  return { id: doc.id, ...data };
}

/**
 * Tasks grouped into Whova's project buckets, each with its own completion.
 *
 * A single overall percentage is the number nobody wants: "the event is 62%
 * ready" tells you nothing, while "Venue 3/9, AV 0/6" tells you what to chase.
 */
export async function listProjects(): Promise<TaskProject[]> {
  const tasks = await listTasks();

  const byProject = new Map<string, TaskRow[]>();
  for (const t of tasks) {
    const bucket = byProject.get(t.project);
    if (bucket) bucket.push(t);
    else byProject.set(t.project, [t]);
  }

  return [...byProject.entries()]
    .map(([name, rows]) => {
      const done = rows.filter((t) => t.status === 'done').length;
      return {
        name,
        tasks: rows,
        total: rows.length,
        done,
        blocked: rows.filter((t) => t.status === 'blocked').length,
        pct: rows.length === 0 ? 0 : Math.round((done / rows.length) * 100),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Existing project names, for the form's datalist — free text that is not a free-for-all. */
export async function projectNames(): Promise<string[]> {
  const tasks = await listTasks();
  return [...new Set(tasks.map((t) => t.project))].sort((a, b) => a.localeCompare(b));
}

/**
 * Where the one-click advance sends a task.
 *
 * `done` cycles back to `todo` because "reopen" is the only other thing anyone
 * wants from a finished row, and `blocked` goes to `doing` because unblocking
 * something means work resumed on it, not that it went back in the queue.
 * Lives here rather than in `actions.ts` so the button can label itself with
 * the destination — a `'use server'` module may only export async functions.
 */
export function nextStatus(status: TaskStatus): TaskStatus {
  switch (status) {
    case 'todo':
      return 'doing';
    case 'doing':
      return 'done';
    case 'done':
      return 'todo';
    case 'blocked':
      return 'doing';
  }
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface DocumentRow {
  id: string;
  title: string;
  description: string;
  /** A link to something hosted elsewhere. Nothing in this repo uploads a file. */
  url: string;
  kind: DocumentDoc['kind'];
  visibleToTicketTypes: string[];
  sessionId?: string;
  status: DocumentDoc['status'];
  order: number;
  /** The link's host, so the list shows at a glance where the file actually lives. */
  host: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    // A malformed URL is worth seeing rather than hiding — the row renders it
    // as "not a URL" and the organizer can fix the one that is broken.
    return '';
  }
}

function toDocumentRow(id: string, d: DocumentDoc): DocumentRow {
  return {
    id,
    title: d.title,
    description: d.description ?? '',
    url: d.url ?? '',
    kind: d.kind ?? 'link',
    visibleToTicketTypes: d.visibleToTicketTypes ?? [],
    sessionId: d.sessionId,
    status: d.status ?? 'draft',
    order: d.order ?? 0,
    host: hostOf(d.url ?? ''),
  };
}

export async function listDocuments(): Promise<DocumentRow[]> {
  const snap = await db().collection(COLLECTIONS.documents).where('eventId', '==', EVENT_ID).get();
  return snap.docs
    .map((d) => toDocumentRow(d.id, d.data() as DocumentDoc))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export async function getDocument(id: string): Promise<WithId<DocumentDoc> | null> {
  const doc = await db().collection(COLLECTIONS.documents).doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() as DocumentDoc;
  if (data.eventId !== EVENT_ID) return null;
  return { id: doc.id, ...data };
}
