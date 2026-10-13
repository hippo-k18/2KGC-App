import { describe, expect, it } from 'vitest';

import { groupReports, hideLabel, type ReportRow } from './reports-core';

const row = (over: Partial<ReportRow>): ReportRow => ({
  id: 'x',
  reporterId: 'u1',
  reporterName: 'U1',
  targetType: 'communityPost',
  targetKey: 'communityPost:p1',
  targetPath: 'communityPosts/p1',
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
      row({ id: 'd', targetKey: 'reply:p1:r1', targetType: 'reply', targetPath: 'communityPosts/p1/replies/r1' }),
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
      row({ id: '1', targetKey: 'user:a', targetType: 'user', createdAt: '2026-10-12T08:00:00.000Z' }),
      row({ id: '2', targetKey: 'user:b', targetType: 'user', createdAt: '2026-10-12T09:00:00.000Z' }),
      row({ id: '3', targetKey: 'user:b', targetType: 'user', createdAt: '2026-10-12T09:30:00.000Z' }),
      row({ id: '4', targetKey: 'user:c', targetType: 'user', status: 'dismissed', createdAt: '2026-10-11T00:00:00.000Z' }),
      row({ id: '5', targetKey: 'user:d', targetType: 'user', status: 'actioned', createdAt: '2026-10-12T00:00:00.000Z' }),
    ]);
    expect(groups.map((g) => g.targetKey)).toEqual(['user:b', 'user:a', 'user:d', 'user:c']);
  });

  it('carries the reported author when any report knew it', () => {
    const [g] = groupReports([row({ id: 'a' }), row({ id: 'b', targetAuthorId: 'bad' })]);
    expect(g.targetAuthorId).toBe('bad');
  });
});

describe('hideLabel', () => {
  it('offers Hide only where there is content to hide', () => {
    expect(hideLabel('communityPost', false)).toBe('Hide post');
    expect(hideLabel('reply', false)).toBe('Hide reply');
    expect(hideLabel('message', true)).toBe('Hide message');
    expect(hideLabel('message', false)).toBe('Hide their messages here');
    expect(hideLabel('user', false)).toBeNull();
    expect(hideLabel('job', false)).toBeNull();
  });
});
