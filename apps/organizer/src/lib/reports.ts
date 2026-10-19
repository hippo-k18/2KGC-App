import 'server-only';

import {
  COLLECTIONS,
  DELETED_USER_ID,
  DELETED_USER_NAME,
  EVENT_ID,
  isPlainId,
  SUBCOLLECTIONS,
  type ReportDoc,
} from '@kgc/shared';
import { FieldValue } from 'firebase-admin/firestore';
import { appendAudit } from './audit';
import { recordError } from './errors';
import { db } from './firestore';
import {
  conversationAuthors,
  groupReports,
  isGoneCard,
  targetOf,
  type ReportGroup,
  type ReportRow,
  type ReportStatus,
} from './reports-core';

/**
 * The Reports queue (Engagement › Community › Reports): what attendees reported
 * from the app, with the content as it is now, and the organizer's decision.
 *
 * Read and written only here, with the Admin SDK. The rules let a client create
 * a report and nothing else, so no attendee can see who reported them.
 *
 * ── The content is re-read, not taken from the report ───────────────────────
 *
 * A report carries a path, not a copy. The author may have edited the post
 * since, an organizer may already have hidden it from the Community Board, or it
 * may be gone. The queue shows what is there now and says so when it is not,
 * because acting on a stale copy is how the wrong thing gets hidden.
 *
 * ── One decision per target ─────────────────────────────────────────────────
 *
 * Five people reporting one reply is one decision. Resolving closes every open
 * report on that target together, and each is stamped with who decided.
 *
 * ── Every path comes from the key ───────────────────────────────────────────
 *
 * Never from the report's stored `targetPath`, for reading or for writing:
 * `targetOf()` in `reports-core.ts` is the one derivation, used by the card and
 * by Hide alike. See the note there for the forged report that made this a
 * rule (T230).
 */

export interface ReportedContent {
  /** False when the document no longer exists, or the key names nothing. */
  exists: boolean;
  title?: string;
  body?: string;
  authorId?: string;
  authorName?: string;
  /** visible / hidden / removed for posts and replies; hidden for a message. */
  status?: string;
  /** For a whole-conversation report: the reported person's recent messages there. */
  messages?: { id: string; body: string; at: string; hidden: boolean }[];
  /** The read failed. The card says so and offers Keep, so it can still be cleared. */
  unreadable?: boolean;
}

export interface ReportQueueItem extends ReportGroup {
  content: ReportedContent;
}

function iso(t: unknown): string {
  try {
    return (t as { toDate(): Date }).toDate().toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

/** What a reporter with no profile is called, rather than a raw uid. */
const DEMO_NAME = 'Demo login';
const UNKNOWN_NAME = 'Unknown attendee';

/**
 * Names for everyone on the page. The shared demo login carries `demo: true`
 * on its profile (T224) and is named as what it is; anyone with no profile at
 * all is "Unknown attendee", never their uid.
 */
async function names(extra: Iterable<unknown> = []): Promise<(uid: unknown) => string> {
  const snap = await db().collection(COLLECTIONS.users).where('eventId', '==', EVENT_ID).get();
  const map = new Map<string, string>();
  const label = (doc: FirebaseFirestore.DocumentSnapshot) =>
    doc.get('demo') === true ? DEMO_NAME : String(doc.get('name') || '') || UNKNOWN_NAME;
  for (const d of snap.docs) map.set(d.id, label(d));
  map.set(DELETED_USER_ID, DELETED_USER_NAME);
  // A profile written without `eventId` is still a profile. Only plain ids are
  // looked up: a report written with the Admin SDK can carry a reporter id of
  // `..` or a number, and one such lookup threw the whole queue (T234). The
  // rules make that impossible from the app; this makes it harmless anyway.
  const missing = [...new Set(extra)].filter((uid): uid is string => isPlainId(uid) && !map.has(uid));
  if (missing.length) {
    try {
      const docs = await db().getAll(...missing.map((uid) => db().collection(COLLECTIONS.users).doc(uid)));
      for (const d of docs) if (d.exists) map.set(d.id, label(d));
    } catch (err) {
      recordError('reports.names', err);
    }
  }
  return (uid: unknown) => (typeof uid === 'string' ? map.get(uid) : undefined) ?? UNKNOWN_NAME;
}

type Messages = FirebaseFirestore.CollectionReference;

/** The thread's participants, or null when it is gone. */
async function participantsOf(threadId: string): Promise<string[] | null> {
  const t = await db().collection(COLLECTIONS.threads).doc(threadId).get();
  return t.exists ? ((t.get('participantIds') as string[] | undefined) ?? []) : null;
}

const messagesOf = (threadId: string): Messages =>
  db().collection(COLLECTIONS.threads).doc(threadId).collection(SUBCOLLECTIONS.messages);

async function readContent(group: ReportGroup, name: (uid: string) => string): Promise<ReportedContent> {
  const of = targetOf(group.targetKey);
  if (!of) return { exists: false };
  const { target, path } = of;

  if (target.type === 'job') {
    // The Job Board is not built yet (T209). A report of one is kept for when it is.
    return { exists: false };
  }

  if (target.type === 'message') {
    if (target.messageId) {
      const m = await messagesOf(target.threadId).doc(target.messageId).get();
      if (!m.exists) return { exists: false };
      const senderId = String(m.get('senderId') ?? '');
      return {
        exists: true,
        body: String(m.get('body') ?? ''),
        authorId: senderId,
        authorName: name(senderId),
        status: m.get('hidden') === true ? 'hidden' : 'visible',
      };
    }
    // A report of the whole conversation is about the other person in it,
    // worked out from the thread, the same way Hide works it out.
    const participants = await participantsOf(target.threadId);
    if (!participants) return { exists: false };
    const authors = conversationAuthors(participants, group.reports.map((r) => r.reporterId));
    const snap = await messagesOf(target.threadId).orderBy('sentAt', 'desc').limit(40).get();
    const theirs = snap.docs
      .filter((d) => authors.includes(String(d.get('senderId'))))
      .slice(0, 10)
      .map((d) => ({ id: d.id, body: String(d.get('body') ?? ''), at: iso(d.get('sentAt')), hidden: d.get('hidden') === true }))
      .reverse();
    return {
      exists: true,
      authorId: authors[0],
      authorName: authors.length ? authors.map(name).join(' and ') : 'nobody (the reporter is not in this conversation)',
      messages: theirs,
    };
  }

  const snap = await db().doc(path).get();
  if (!snap.exists) return { exists: false };
  const d = snap.data()!;
  if (target.type === 'user') {
    return { exists: true, title: d.name, body: [d.title, d.company].filter(Boolean).join(' · '), authorId: snap.id, authorName: d.name };
  }
  return {
    exists: true,
    title: d.title,
    body: d.body,
    authorId: d.authorId,
    authorName: name(d.authorId),
    status: d.status ?? 'visible',
  };
}

export async function listReportQueue(): Promise<ReportQueueItem[]> {
  const snap = await db().collection(COLLECTIONS.reports).where('eventId', '==', EVENT_ID).get();
  const docs = snap.docs.map((doc) => ({ id: doc.id, r: doc.data() as ReportDoc }));
  const name = await names(docs.map((d) => d.r.reporterId));
  const rows: ReportRow[] = docs.map(({ id, r }) => ({
    id,
    reporterId: typeof r.reporterId === 'string' ? r.reporterId : String(r.reporterId ?? ''),
    reporterName: name(r.reporterId),
    targetKey: r.targetKey,
    reason: r.reason,
    note: r.note,
    status: r.status,
    createdAt: iso(r.createdAt),
    resolvedBy: r.resolvedBy,
    resolvedAt: r.resolvedAt ? iso(r.resolvedAt) : undefined,
    resolution: r.resolution,
  }));
  return withContent(groupReports(rows), (g) => readContent(g, name));
}

/**
 * Each card's content, read on its own. One card's read failing must not take
 * the queue with it: a single report naming a path Firestore refuses once
 * replaced the whole screen with an error, so nobody could act on any report
 * (T232). A failed card says so and still offers Keep.
 */
export function withContent<G extends ReportGroup>(
  groups: G[],
  read: (g: G) => Promise<ReportedContent>,
): Promise<(G & { content: ReportedContent })[]> {
  return Promise.all(
    groups.map(async (g) => {
      try {
        return { ...g, content: await read(g) };
      } catch (err) {
        recordError('reports.read', err);
        return { ...g, content: { exists: false, unreadable: true } };
      }
    }),
  );
}

export type ReportDecision = 'hide' | 'keep' | 'reopen';

/**
 * Close (or reopen) every report on one target, and hide the content when the
 * decision is to hide it. Hiding is a status change, never a delete, for the
 * reasons `moderation.ts` gives: it is reversible from the Community Board, and
 * the hidden post is the evidence.
 */
export async function resolveReports(input: {
  targetKey: string;
  decision: ReportDecision;
  actor: string;
}): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  const snap = await db()
    .collection(COLLECTIONS.reports)
    .where('eventId', '==', EVENT_ID)
    .where('targetKey', '==', input.targetKey)
    .get();
  if (snap.empty) return { ok: false, error: 'Those reports are no longer there.' };

  const reports = snap.docs.map((d) => ({ ref: d.ref, data: d.data() as ReportDoc }));
  const of = targetOf(input.targetKey);

  if (input.decision === 'hide') {
    if (!of) return { ok: false, error: 'This report does not name anything the app shows. Keep it instead.' };
    let hidden: Awaited<ReturnType<typeof hideTarget>>;
    try {
      hidden = await hideTarget(of, reports.map((r) => r.data.reporterId), input.actor);
    } catch (err) {
      recordError('reports.hide', err);
      return { ok: false, error: 'This could not be hidden. Keep it to close the report.' };
    }
    if (!hidden.ok) return hidden;
  }

  const now = new Date();
  const targets =
    input.decision === 'reopen'
      ? reports.filter((r) => r.data.status !== 'open')
      : reports.filter((r) => r.data.status === 'open');
  const batch = db().batch();
  for (const r of targets) {
    batch.update(
      r.ref,
      input.decision === 'reopen'
        ? { status: 'open', resolvedBy: FieldValue.delete(), resolvedAt: FieldValue.delete(), resolution: FieldValue.delete() }
        : {
            status: input.decision === 'hide' ? 'actioned' : 'dismissed',
            resolvedBy: input.actor,
            resolvedAt: now,
            resolution: input.decision === 'hide' ? 'hidden' : 'kept',
          },
    );
  }
  await batch.commit();

  await appendAudit({
    actor: input.actor,
    action: 'report.resolve',
    targetPath: of?.path ?? COLLECTIONS.reports,
    targetId: input.targetKey,
    before: { open: reports.filter((r) => r.data.status === 'open').length },
    after: { decision: input.decision, reports: targets.length },
  });
  return { ok: true, changed: targets.length };
}

/**
 * Keep, in one go, every open report whose content is gone. A wave of reports
 * on deleted posts (or on keys filed before the rules required a target) is
 * otherwise one click per card (T234). Each report gets its own audit entry,
 * so the log still says who closed which report and why.
 */
export async function keepAllForDeletedContent(actor: string): Promise<{ cards: number; reports: number }> {
  const gone = (await listReportQueue()).filter(isGoneCard);
  const now = new Date();
  let closed = 0;
  for (const card of gone) {
    const snap = await db()
      .collection(COLLECTIONS.reports)
      .where('eventId', '==', EVENT_ID)
      .where('targetKey', '==', card.targetKey)
      .get();
    const open = snap.docs.filter((d) => d.get('status') === 'open');
    for (let i = 0; i < open.length; i += 400) {
      const batch = db().batch();
      for (const d of open.slice(i, i + 400)) {
        batch.update(d.ref, { status: 'dismissed', resolvedBy: actor, resolvedAt: now, resolution: 'kept' });
      }
      await batch.commit();
    }
    for (const d of open) {
      await appendAudit({
        actor,
        action: 'report.resolve',
        targetPath: d.ref.path,
        targetId: d.id,
        before: { status: 'open' },
        after: { decision: 'keep', targetKey: card.targetKey, bulk: 'content gone' },
      });
    }
    closed += open.length;
  }
  return { cards: gone.length, reports: closed };
}

async function hideTarget(
  { target, path }: NonNullable<ReturnType<typeof targetOf>>,
  reporterIds: string[],
  actor: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (target.type === 'communityPost' || target.type === 'reply') {
    const ref = db().doc(path);
    const snap = await ref.get();
    if (!snap.exists) return { ok: true };
    const before = snap.get('status') ?? 'visible';
    if (before !== 'hidden') {
      await ref.update({ status: 'hidden', updatedAt: new Date() });
      await appendAudit({
        actor,
        action: 'moderation.setStatus',
        targetPath: ref.path,
        targetId: ref.id,
        before: { status: before },
        after: { status: 'hidden', kind: target.type === 'reply' ? 'reply' : 'post', via: 'report' },
      });
    }
    return { ok: true };
  }

  if (target.type === 'message') {
    const messages = messagesOf(target.threadId);
    let refs: FirebaseFirestore.DocumentReference[];
    if (target.messageId) {
      const m = await messages.doc(target.messageId).get();
      if (!m.exists) return { ok: true };
      refs = [m.ref];
    } else {
      const participants = await participantsOf(target.threadId);
      if (!participants) return { ok: true };
      const authors = conversationAuthors(participants, reporterIds);
      if (!authors.length) return { ok: false, error: 'Nobody who reported this is in the conversation, so there is nobody to hide.' };
      const snaps = await Promise.all(authors.map((a) => messages.where('senderId', '==', a).get()));
      refs = snaps.flatMap((s) => s.docs.map((d) => d.ref));
    }
    // Batches cap at 500 writes; a long conversation can have more.
    for (let i = 0; i < refs.length; i += 400) {
      const batch = db().batch();
      for (const ref of refs.slice(i, i + 400)) batch.update(ref, { hidden: true });
      await batch.commit();
    }
    await appendAudit({
      actor,
      action: 'moderation.setStatus',
      targetPath: path,
      targetId: target.messageId ?? target.threadId,
      before: {},
      after: { hidden: true, kind: 'message', messages: refs.length, via: 'report' },
    });
    return { ok: true };
  }

  return { ok: false, error: 'There is nothing to hide for this kind of report. Keep it or contact the person.' };
}

export const reportCounts = (items: ReportQueueItem[]): Record<ReportStatus, number> => ({
  open: items.filter((i) => i.status === 'open').length,
  actioned: items.filter((i) => i.status === 'actioned').length,
  dismissed: items.filter((i) => i.status === 'dismissed').length,
});
