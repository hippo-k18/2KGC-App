import { reportReasonLabel, type ReportTargetType } from '@kgc/shared';

/**
 * The Reports queue's arithmetic, without Firestore, so it is tested on its own
 * (`reports-core.test.ts`).
 *
 * Several people reporting the same post is one decision, not five. Reports are
 * grouped by `targetKey`, and the group is open while any report in it is open.
 */

export type ReportStatus = 'open' | 'actioned' | 'dismissed';

export interface ReportRow {
  id: string;
  reporterId: string;
  reporterName: string;
  targetType: ReportTargetType;
  targetKey: string;
  targetPath: string;
  targetAuthorId?: string;
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
  targetType: ReportTargetType;
  targetPath: string;
  targetAuthorId?: string;
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
    groups.push({
      targetKey,
      targetType: first.targetType,
      targetPath: first.targetPath,
      targetAuthorId: list.find((r) => r.targetAuthorId)?.targetAuthorId,
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

/** What "Hide" does for this kind of target, or null when there is nothing to hide. */
export function hideLabel(type: ReportTargetType, hasMessageId: boolean): string | null {
  switch (type) {
    case 'communityPost':
      return 'Hide post';
    case 'reply':
      return 'Hide reply';
    case 'message':
      return hasMessageId ? 'Hide message' : 'Hide their messages here';
    default:
      return null;
  }
}
