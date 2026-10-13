import { describe, expect, it } from 'vitest';

import { conversationAuthors, groupReports, hideLabel, targetLabel, targetOf, type ReportRow } from './reports-core';

const row = (over: Partial<ReportRow>): ReportRow => ({
  id: 'x',
  reporterId: 'u1',
  reporterName: 'U1',
  targetKey: 'communityPost:p1',
  reason: 'spam',
  status: 'open',
  createdAt: '2026-10-12T10:00:00.000Z',
  ...over,
});

describe('groupReports', () => {
  it('makes one group per target, with every report on it', () => {
    const groups = groupReports([
      row({ id: 'a', reporterId: 'u1', reason: 'offensive' }),
      row({ id: 'b', reporterId: 'u2', reason: 'offensive', createdAt: '2026-10-12T11:00:00.000Z' }),
      row({ id: 'c', reporterId: 'u3', reason: 'spam', createdAt: '2026-10-12T09:00:00.000Z' }),
      row({ id: 'd', targetKey: 'reply:p1:r1' }),
    ]);
    expect(groups).toHaveLength(2);
    const post = groups.find((g) => g.targetKey === 'communityPost:p1')!;
    expect(post.reports.map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(post.reasons).toBe('Offensive or abusive ×2 · Spam');
    expect(post.firstAt).toBe('2026-10-12T09:00:00.000Z');
    expect(post.lastAt).toBe('2026-10-12T11:00:00.000Z');
  });

  it('a group stays open while any report in it is open', () => {
    const [g] = groupReports([row({ id: 'a', status: 'dismissed' }), row({ id: 'b', status: 'open' })]);
    expect(g.status).toBe('open');
    const [h] = groupReports([row({ id: 'a', status: 'dismissed' }), row({ id: 'b', status: 'actioned' })]);
    expect(h.status).toBe('actioned');
  });

  it('puts open first, most reported first, then oldest; closed newest first', () => {
    const groups = groupReports([
      row({ id: '1', targetKey: 'user:a', createdAt: '2026-10-12T08:00:00.000Z' }),
      row({ id: '2', targetKey: 'user:b', createdAt: '2026-10-12T09:00:00.000Z' }),
      row({ id: '3', targetKey: 'user:b', createdAt: '2026-10-12T09:30:00.000Z' }),
      row({ id: '4', targetKey: 'user:c', status: 'dismissed', createdAt: '2026-10-11T00:00:00.000Z' }),
      row({ id: '5', targetKey: 'user:d', status: 'actioned', createdAt: '2026-10-12T00:00:00.000Z' }),
    ]);
    expect(groups.map((g) => g.targetKey)).toEqual(['user:b', 'user:a', 'user:d', 'user:c']);
  });

  it('takes the target and its path from the key alone', () => {
    const [g] = groupReports([row({ id: 'a', targetKey: 'reply:p1:r1' })]);
    expect(g.target).toEqual({ type: 'reply', postId: 'p1', replyId: 'r1' });
    expect(g.targetPath).toBe('communityPosts/p1/replies/r1');
    const [bad] = groupReports([row({ id: 'b', targetKey: 'communityPost:x/../sessions' })]);
    expect(bad.target).toBeNull();
    expect(bad.targetPath).toBeNull();
  });
});

describe('targetOf', () => {
  it('derives the one path the dashboard reads and writes', () => {
    expect(targetOf('communityPost:p1')?.path).toBe('communityPosts/p1');
    expect(targetOf('message:a_b:m1')?.path).toBe('threads/a_b/messages/m1');
    expect(targetOf('user:u1')?.path).toBe('directory/u1');
    expect(targetOf('communityPost:sessions/keynote')).toBeNull();
  });
});

describe('conversationAuthors', () => {
  it('is the other participant for each reporter in the thread, and nobody for an outsider', () => {
    expect(conversationAuthors(['bad', 'good'], ['good'])).toEqual(['bad']);
    expect(conversationAuthors(['bad', 'good'], ['good', 'bad'])).toEqual(['bad', 'good']);
    expect(conversationAuthors(['bad', 'good'], ['stranger'])).toEqual([]);
    expect(conversationAuthors(['solo'], ['solo'])).toEqual([]);
  });
});

describe('hideLabel', () => {
  it('offers Hide only where there is content to hide', () => {
    expect(hideLabel({ type: 'communityPost', postId: 'p' })).toBe('Hide post');
    expect(hideLabel({ type: 'reply', postId: 'p', replyId: 'r' })).toBe('Hide reply');
    expect(hideLabel({ type: 'message', threadId: 't', messageId: 'm' })).toBe('Hide message');
    expect(hideLabel({ type: 'message', threadId: 't' })).toBe('Hide their messages here');
    expect(hideLabel({ type: 'user', uid: 'u' })).toBeNull();
    expect(hideLabel({ type: 'job', jobId: 'j' })).toBeNull();
    expect(hideLabel(null)).toBeNull();
    expect(targetLabel(null)).toBe('Unreadable report');
  });
});
