import { describe, expect, it } from 'vitest';

import {
  GROUP_LABEL,
  TEMPLATES,
  TEMPLATE_INFO,
  dayStartMs,
  filterRows,
  framedHtml,
  parseFilters,
  rangeMs,
  relatedLink,
  splitAddress,
  statusDetail,
  templateLabel,
  type EmailLogRow,
} from './email-log-core';

/** The Email Log's list: names, filters and links (T274). */
const NY = 'America/New_York';

const row = (over: Partial<EmailLogRow> & { id: string }): EmailLogRow => ({
  atMs: Date.parse('2026-10-18T16:00:00Z'),
  to: 'ada@example.com',
  subject: 'Subject',
  template: 'cfp-received',
  status: 'sent',
  hasBody: true,
  ...over,
});

describe('names', () => {
  it('gives every template a friendly name in a known group', () => {
    for (const t of TEMPLATES) {
      expect(TEMPLATE_INFO[t].label).not.toBe(t);
      expect(GROUP_LABEL[TEMPLATE_INFO[t].group]).toBeTruthy();
    }
  });

  it('uses Min’s numbers for the call for speakers', () => {
    expect(templateLabel('cfp-received')).toBe('E1 Submission received');
    expect(templateLabel('purchase-confirmation')).toBe('Ticket confirmation');
    expect(templateLabel('dashboard-sign-in-code')).toBe('Dashboard sign-in code');
  });

  it('shows an unknown template as itself rather than failing', () => {
    expect(templateLabel('something-new')).toBe('something-new');
  });
});

describe('reading the filters', () => {
  it('keeps the good ones and drops the malformed', () => {
    expect(
      parseFilters({ from: '2026-10-01', to: 'yesterday', type: 'cfp-nudge', status: 'bogus', q: ' ada ' }),
    ).toEqual({ from: '2026-10-01', template: 'cfp-nudge', q: 'ada' });
  });

  it('reads a whole group from the select and from the CFP screens’ link', () => {
    expect(parseFilters({ type: 'group:cfp' })).toEqual({ group: 'cfp' });
    expect(parseFilters({ group: 'cfp' })).toEqual({ group: 'cfp' });
    expect(parseFilters({ type: 'group:nonsense' })).toEqual({});
  });
});

describe('the date range is New York days', () => {
  it('starts a day at local midnight, either side of the clock change', () => {
    expect(new Date(dayStartMs('2026-10-18', NY)).toISOString()).toBe('2026-10-18T04:00:00.000Z');
    expect(new Date(dayStartMs('2026-11-02', NY)).toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });

  it('includes the whole of the last day', () => {
    const { startMs, endMs } = rangeMs({ from: '2026-10-18', to: '2026-10-18' }, NY);
    expect(endMs! - startMs!).toBe(86_400_000);
  });

  it('puts 23:30 in New York on that day, though it is the next day in UTC', () => {
    const late = row({ id: 'late', atMs: Date.parse('2026-10-19T03:30:00Z') });
    const next = row({ id: 'next', atMs: Date.parse('2026-10-19T04:30:00Z') });
    expect(filterRows([late, next], { to: '2026-10-18' }, NY).map((r) => r.id)).toEqual(['late']);
    expect(filterRows([late, next], { from: '2026-10-19' }, NY).map((r) => r.id)).toEqual(['next']);
  });
});

describe('filtering', () => {
  const rows = [
    row({ id: 'e1', template: 'cfp-received', atMs: 1 }),
    row({ id: 'ticket', template: 'purchase-confirmation', orderId: 'ord_77', to: 'bilal@example.com', atMs: 3 }),
    row({ id: 'fail', template: 'cfp-nudge', status: 'failed', error: '422 invalid', atMs: 2 }),
  ];

  it('is newest first', () => {
    expect(filterRows(rows, {}, NY).map((r) => r.id)).toEqual(['ticket', 'fail', 'e1']);
  });

  it('by email, group and status', () => {
    expect(filterRows(rows, { template: 'cfp-nudge' }, NY).map((r) => r.id)).toEqual(['fail']);
    expect(filterRows(rows, { group: 'cfp' }, NY).map((r) => r.id)).toEqual(['fail', 'e1']);
    expect(filterRows(rows, { status: 'failed' }, NY).map((r) => r.id)).toEqual(['fail']);
  });

  it('searches the recipient and the related ids, ignoring case', () => {
    expect(filterRows(rows, { q: 'BILAL' }, NY).map((r) => r.id)).toEqual(['ticket']);
    expect(filterRows(rows, { q: 'ord_77' }, NY).map((r) => r.id)).toEqual(['ticket']);
  });
});

describe('links and words', () => {
  it('links a CFP email to its submission and a ticket email to its order', () => {
    expect(relatedLink({ template: 'cfp-received', submissionId: 'sub_1' })?.href).toBe(
      '/content/call-for-speakers-abstracts/submissions/sub_1',
    );
    expect(relatedLink({ template: 'purchase-confirmation', orderId: 'ord_1' })?.href).toBe(
      '/tickets/orders-and-transactions/attendee-orders?q=ord_1',
    );
    expect(relatedLink({ template: 'sign-in-code' })).toBeNull();
  });

  it('says why a send did not go', () => {
    expect(statusDetail({ status: 'failed', error: '422 invalid' })).toBe('422 invalid');
    expect(statusDetail({ status: 'skipped', reason: 'RESEND_API_KEY is not set' })).toContain('RESEND');
    expect(statusDetail({ status: 'sent', bounced: true })).toBe('Accepted, then bounced.');
    expect(statusDetail({ status: 'sent' })).toBeNull();
  });
});

describe('the Gmail-style frame', () => {
  it('splits a From header into name and address', () => {
    expect(splitAddress('Knowledge Graph Conference <hello@knowledgegraph.tech>')).toEqual({
      name: 'Knowledge Graph Conference',
      address: 'hello@knowledgegraph.tech',
    });
    expect(splitAddress('a@b.co')).toEqual({ name: 'a@b.co', address: 'a@b.co' });
  });

  it('makes every link open outside the frame', () => {
    expect(framedHtml('<html><head><title>x</title></head></html>')).toContain('<head><base target="_blank">');
    expect(framedHtml('<p>bare</p>')).toContain('<base target="_blank"></head><body><p>bare</p>');
  });

  it('does not mistake a <header> for the <head>', () => {
    const out = framedHtml('<header>x</header>');
    expect(out.startsWith('<!doctype html>')).toBe(true);
    expect(out).toContain('<header>x</header>');
  });
});
