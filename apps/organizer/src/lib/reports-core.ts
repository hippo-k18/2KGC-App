import {
  parseReportTargetKey,
  reportReasonLabel,
  reportTargetPath,
  type ReportTarget,
  type ReportTargetType,
} from '@kgc/shared';

/**
 * The Reports queue's arithmetic, without Firestore, so it is tested on its own
 * (`reports-core.test.ts`).
 *
 * Several people reporting the same post is one decision, not five. Reports are
 * grouped by `targetKey`, and the group is open while any report in it is open.
 *
 * ── The key is the only thing trusted ───────────────────────────────────────
 *
 * A report is a document an attendee wrote. Its stored `targetType` and
 * `targetPath` are ignored here: a "report of a post" once carried
 * `sessions/keynote`, the card showed the real post, and Hide hid the keynote
 * (T230). `targetOf()` reads the target out of the key, and the card, the
 * content read and every write go through it, so what the organizer sees is
 * what the button changes.
 */

/** What a report key names, and where it lives. Null for a key no app could have written. */
export function targetOf(targetKey: string): { target: ReportTarget; path: string } | null {
  const target = parseReportTargetKey(targetKey);
  return target ? { target, path: reportTargetPath(target) } : null;
}

/**
 * Whose messages a whole-conversation report is about: for each reporter in
 * the thread, the other person in it. Derived from the thread, not from the
 * report's `targetAuthorId`, and a reporter who is not in the thread names
 * nobody. Usually one person; two when both sides reported each other.
 */
export function conversationAuthors(participantIds: readonly string[], reporterIds: readonly string[]): string[] {
  const out = new Set<string>();
  for (const r of reporterIds) {
    if (participantIds.length !== 2 || !participantIds.includes(r)) continue;
    const other = participantIds[0] === r ? participantIds[1] : participantIds[0];
    if (other !== r) out.add(other);
  }
  return [...out];
}

export type ReportStatus = 'open' | 'actioned' | 'dismissed';

export interface ReportRow {
  id: string;
  reporterId: string;
  reporterName: string;
  targetKey: string;
  reason: string;
  note?: string;
  status: ReportStatus;
  createdAt: string;
  resolvedBy?: string;
  resolvedAt?: string;
  resolution?: 'hidden' | 'kept';
}

export interface ReportGroup {
  targetKey: string;
  /** From the key; null when the key is not one the app writes (shown, never acted on). */
  target: ReportTarget | null;
  targetPath: string | null;
  status: ReportStatus;
  reports: ReportRow[];
  /** "Offensive or abusive ×2 · Spam" */
  reasons: string;
  firstAt: string;
  lastAt: string;
}

export function groupReports(rows: ReportRow[]): ReportGroup[] {
  const byKey = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const list = byKey.get(r.targetKey) ?? [];
    list.push(r);
    byKey.set(r.targetKey, list);
  }

  const groups: ReportGroup[] = [];
  for (const [targetKey, list] of byKey) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const counts = new Map<string, number>();
    for (const r of list) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
    const reasons = [...counts]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, n]) => (n > 1 ? `${reportReasonLabel(reason)} ×${n}` : reportReasonLabel(reason)))
      .join(' · ');
    const first = list[0];
    const of = targetOf(targetKey);
    groups.push({
      targetKey,
      target: of?.target ?? null,
      targetPath: of?.path ?? null,
      status: list.some((r) => r.status === 'open')
        ? 'open'
        : list.some((r) => r.status === 'actioned')
          ? 'actioned'
          : 'dismissed',
      reports: list,
      reasons,
      firstAt: first.createdAt,
      lastAt: list[list.length - 1].createdAt,
    });
  }

  // Open first, and within open the most reported, then the oldest: the post
  // five people flagged an hour ago comes before one flagged a minute ago.
  // Closed ones newest first, because that is the history somebody looks up.
  return groups.sort((a, b) => {
    if ((a.status === 'open') !== (b.status === 'open')) return a.status === 'open' ? -1 : 1;
    if (a.status === 'open') return b.reports.length - a.reports.length || a.firstAt.localeCompare(b.firstAt);
    return b.lastAt.localeCompare(a.lastAt);
  });
}

export const TARGET_LABEL: Record<ReportTargetType, string> = {
  communityPost: 'Post',
  reply: 'Reply',
  message: 'Message',
  user: 'Profile',
  job: 'Job',
};

/** What "Hide" does for this target, or null when there is nothing to hide. */
export function hideLabel(target: ReportTarget | null): string | null {
  switch (target?.type) {
    case 'communityPost':
      return 'Hide post';
    case 'reply':
      return 'Hide reply';
    case 'message':
      return target.messageId ? 'Hide message' : 'Hide their messages here';
    default:
      return null;
  }
}

export function targetLabel(target: ReportTarget | null): string {
  return target ? TARGET_LABEL[target.type] : 'Unreadable report';
}
