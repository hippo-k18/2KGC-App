import 'server-only';

import {
  COLLECTIONS,
  DELETED_USER_ID,
  DELETED_USER_NAME,
  EVENT_ID,
  SUBCOLLECTIONS,
  type ReportDoc,
  type UserDoc,
} from '@kgc/shared';
import { FieldValue } from 'firebase-admin/firestore';
import { appendAudit } from './audit';
import { db } from './firestore';
import { groupReports, type ReportGroup, type ReportRow, type ReportStatus } from './reports-core';

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
 */

export interface ReportedContent {
  /** False when the document no longer exists. */
  exists: boolean;
  title?: string;
  body?: string;
  authorId?: string;
  authorName?: string;
  /** visible / hidden / removed for posts and replies; hidden for a message. */
  status?: string;
  /** For a whole-conversation report: the reported person's recent messages there. */
  messages?: { id: string; body: string; at: string; hidden: boolean }[];
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

async function names(): Promise<Map<string, string>> {
  const snap = await db().collection(COLLECTIONS.users).where('eventId', '==', EVENT_ID).get();
  const map = new Map(snap.docs.map((d) => [d.id, (d.data() as UserDoc).name || d.id]));
  map.set(DELETED_USER_ID, DELETED_USER_NAME);
  return map;
}

/** `message:<threadId>` or `message:<threadId>:<messageId>`. */
function messageParts(targetKey: string): { threadId: string; messageId?: string } {
  const [, threadId, messageId] = targetKey.split(':');
  return { threadId, messageId };
}

async function readContent(group: ReportGroup, who: Map<string, string>): Promise<ReportedContent> {
  const name = (uid?: string) => (uid ? (who.get(uid) ?? uid) : undefined);

  if (group.targetType === 'message') {
    const { threadId, messageId } = messageParts(group.targetKey);
    const thread = db().collection(COLLECTIONS.threads).doc(threadId);
    if (messageId) {
      const m = await thread.collection(SUBCOLLECTIONS.messages).doc(messageId).get();
      if (!m.exists) return { exists: false };
      const d = m.data()!;
      return {
        exists: true,
        body: d.body,
        authorId: d.senderId,
        authorName: name(d.senderId),
        status: d.hidden ? 'hidden' : 'visible',
      };
    }
    // A report of the whole conversation is about the other person in it.
    const author = group.targetAuthorId;
    const snap = await thread.collection(SUBCOLLECTIONS.messages).orderBy('sentAt', 'desc').limit(40).get();
    if (snap.empty && !(await thread.get()).exists) return { exists: false };
    const mine = snap.docs
      .filter((d) => !author || d.get('senderId') === author)
      .slice(0, 10)
      .map((d) => ({ id: d.id, body: String(d.get('body') ?? ''), at: iso(d.get('sentAt')), hidden: d.get('hidden') === true }))
      .reverse();
    return { exists: true, authorId: author, authorName: name(author), messages: mine };
  }

  if (group.targetType === 'job') {
    // The Job Board is not built yet (T209). A report of one is kept for when it is.
    return { exists: false };
  }

  const snap = await db().doc(group.targetPath).get();
  if (!snap.exists) return { exists: false };
  const d = snap.data()!;
  if (group.targetType === 'user') {
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
  const [snap, who] = await Promise.all([
    db().collection(COLLECTIONS.reports).where('eventId', '==', EVENT_ID).get(),
    names(),
  ]);
  const rows: ReportRow[] = snap.docs.map((doc) => {
    const r = doc.data() as ReportDoc;
    return {
      id: doc.id,
      reporterId: r.reporterId,
      reporterName: who.get(r.reporterId) ?? r.reporterId,
      targetType: r.targetType,
      targetKey: r.targetKey,
      targetPath: r.targetPath,
      targetAuthorId: r.targetAuthorId,
      reason: r.reason,
      note: r.note,
      status: r.status,
      createdAt: iso(r.createdAt),
      resolvedBy: r.resolvedBy,
      resolvedAt: r.resolvedAt ? iso(r.resolvedAt) : undefined,
      resolution: r.resolution,
    };
  });
  const groups = groupReports(rows);
  return Promise.all(groups.map(async (g) => ({ ...g, content: await readContent(g, who) })));
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
  const first = reports[0].data;

  if (input.decision === 'hide') {
    const hidden = await hideTarget(first, input.actor);
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
    targetPath: first.targetPath,
    targetId: input.targetKey,
    before: { open: reports.filter((r) => r.data.status === 'open').length },
    after: { decision: input.decision, reports: targets.length },
  });
  return { ok: true, changed: targets.length };
}

async function hideTarget(r: ReportDoc, actor: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (r.targetType === 'communityPost' || r.targetType === 'reply') {
    const ref = db().doc(r.targetPath);
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
        after: { status: 'hidden', kind: r.targetType === 'reply' ? 'reply' : 'post', via: 'report' },
      });
    }
    return { ok: true };
  }

  if (r.targetType === 'message') {
    const { threadId, messageId } = messageParts(r.targetKey);
    const messages = db().collection(COLLECTIONS.threads).doc(threadId).collection(SUBCOLLECTIONS.messages);
    let refs: FirebaseFirestore.DocumentReference[];
    if (messageId) {
      refs = [messages.doc(messageId)];
    } else {
      if (!r.targetAuthorId) return { ok: false, error: 'This report does not say whose messages to hide.' };
      refs = (await messages.where('senderId', '==', r.targetAuthorId).get()).docs.map((d) => d.ref);
    }
    const batch = db().batch();
    for (const ref of refs) batch.set(ref, { hidden: true }, { merge: true });
    await batch.commit();
    await appendAudit({
      actor,
      action: 'moderation.setStatus',
      targetPath: r.targetPath,
      targetId: messageId ?? threadId,
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
