import { describe, expect, it } from 'vitest';
import {
  JOB_STALE_MS,
  bulkCampaignId,
  dedupeByEmail,
  foldCampaignRows,
  jobLockIsFree,
  jobSummary,
  jobView,
  planBulkSend,
} from './send-jobs-core';

/**
 * T258 #1 and #16: a re-press after a proxy timeout minted a new campaign and
 * mailed the whole list again, and duplicate addresses got two copies.
 */
describe('the campaign id', () => {
  const base = { kind: 'campaign' as const, audience: 'KGC 2026', subject: 'Tickets', body: 'Open now.' };

  it('is the same for the same message to the same audience, so a re-press resumes', () => {
    expect(bulkCampaignId(base)).toBe(bulkCampaignId({ ...base, body: '  Open now.\n' }));
    expect(bulkCampaignId(base)).toMatch(/^campaign_[0-9a-f]{32}$/);
  });

  it('changes with the audience, the subject or the body', () => {
    const id = bulkCampaignId(base);
    expect(bulkCampaignId({ ...base, audience: 'Other' })).not.toBe(id);
    expect(bulkCampaignId({ ...base, subject: 'Tickets!' })).not.toBe(id);
    expect(bulkCampaignId({ ...base, body: 'Open soon.' })).not.toBe(id);
    expect(bulkCampaignId({ ...base, kind: 'message' })).toMatch(/^camp_[0-9a-f]{32}$/);
  });
});

describe('who a run mails', () => {
  const rows = [
    { email: 'Ada@Example.com', name: 'Ada' },
    { email: 'ada@example.com ', name: 'Ada again' },
    { email: 'bo@example.com', name: 'Bo' },
    { email: 'cy@example.com', name: 'Cy' },
    { email: '', name: 'Nobody' },
  ];

  it('mails each folded address once and skips only people already sent', () => {
    const plan = planBulkSend(rows, new Set(['bo@example.com']));
    expect(plan.todo.map((r) => r.name)).toEqual(['Ada', 'Cy']);
    expect(plan).toMatchObject({ total: 3, alreadySent: 1, duplicates: 1 });
  });

  it('dedupes an audience before its count is shown', () => {
    expect(dedupeByEmail(rows).map((r) => r.name)).toEqual(['Ada', 'Bo', 'Cy']);
  });
});

describe('one outcome per person in the history', () => {
  it('lets a later sent row win over an earlier failure', () => {
    const folded = foldCampaignRows([
      { to: 'ada@example.com', status: 'failed' },
      { to: 'Ada@example.com', status: 'sent' },
      { to: 'bo@example.com', status: 'skipped' },
      { to: 'bo@example.com', status: 'failed' },
      { to: null, status: 'sent' },
      { to: null, status: 'sent' },
    ]);
    expect(folded.map((r) => r.status).sort()).toEqual(['failed', 'sent', 'sent', 'sent']);
  });
});

describe('the job lock and its view', () => {
  it('is held while the heartbeat is fresh and free once it is stale', () => {
    expect(jobLockIsFree(undefined, 1)).toBe(true);
    expect(jobLockIsFree(1_000, 1_000 + JOB_STALE_MS)).toBe(false);
    expect(jobLockIsFree(1_000, 1_000 + JOB_STALE_MS + 1)).toBe(true);
  });

  it('calls a running job with an old heartbeat interrupted', () => {
    expect(jobView('running', 0, JOB_STALE_MS + 1)).toBe('interrupted');
    expect(jobView('running', 0, 10)).toBe('running');
    expect(jobView('done', 0, JOB_STALE_MS * 10)).toBe('done');
  });

  it('counts real outcomes in the summary and points at the resume', () => {
    const base = { total: 100, alreadySent: 40, sent: 50, failed: 3, label: 'speakers' };
    expect(jobSummary({ ...base, view: 'done' })).toBe(
      'Finished: sent to 90 of 100 on speakers. 3 failed. Press Send again with the same message to retry them.',
    );
    expect(jobSummary({ ...base, view: 'interrupted' })).toContain('7 not tried yet');
    expect(jobSummary({ ...base, view: 'running' })).toContain('90 of 100');
  });
});
