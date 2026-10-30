import { describe, expect, it } from 'vitest';

import {
  MAX_ATTEMPTS,
  SENDING_LEASE_MS,
  baseAddress,
  candidates,
  lookupAddresses,
  orderFacts,
  checkSettings,
  decide,
  isRemindable,
  parseSkipList,
  reminderCell,
  testAddressReason,
  type PersonFacts,
  type ReminderOrder,
} from './checkout-reminder-core';

/** The checkout reminder's rules (T363). */

const H = 3_600_000;
const D = 24 * H;
const ON = Date.UTC(2026, 9, 29, 12);

const order = (over: Partial<ReminderOrder> = {}): ReminderOrder => ({
  id: 'ord_1',
  email: 'ada@company.com',
  status: 'cancelled',
  channel: 'checkout',
  disputed: false,
  registrationCount: 0,
  ticketNames: [],
  closedAtMs: ON + H,
  ...over,
});
const settings = { delayHours: 24, skipList: ['hartigandeely@gmail.com'] };
const clean: PersonFacts = { bought: false, suppressed: null };

describe('who is a candidate', () => {
  it('is an unpaid checkout with an address, not an invoice, a chargeback, manual or demo', () => {
    expect(isRemindable(order())).toBe(true);
    expect(isRemindable(order({ channel: 'invoice' }))).toBe(false);
    expect(isRemindable(order({ channel: 'manual' }))).toBe(false);
    expect(isRemindable(order({ channel: 'demo' }))).toBe(false);
    expect(isRemindable(order({ disputed: true }))).toBe(false);
    expect(isRemindable(order({ registrationCount: 1 }))).toBe(false);
    expect(isRemindable(order({ status: 'paid' }))).toBe(false);
    expect(isRemindable(order({ status: 'pending' }))).toBe(false);
    expect(isRemindable(order({ email: '' }))).toBe(false);
  });

  it('is nobody while the reminder has never been switched on', () => {
    expect(candidates([order()], { enabled: true, enabledAtMs: undefined }).size).toBe(0);
  });

  it('never includes a checkout that closed before the reminder was switched on', () => {
    const c = candidates([order({ id: 'old', closedAtMs: ON - 1 }), order({ id: 'b', email: 'b@co.com', closedAtMs: ON - D })], { enabled: true, enabledAtMs: ON });
    expect(c.size).toBe(0);
  });

  it('keeps one checkout per person, the latest, whatever the case of the address', () => {
    const c = candidates(
      [order({ id: 'a', closedAtMs: ON + H }), order({ id: 'b', email: 'ADA@Company.com ', closedAtMs: ON + 3 * H }), order({ id: 'c', closedAtMs: ON + 2 * H })],
      { enabled: true, enabledAtMs: ON },
    );
    expect([...c.keys()]).toEqual(['ada@company.com']);
    expect(c.get('ada@company.com')?.id).toBe('b');
  });
});

describe('switched off (T366)', () => {
  it('has no candidates, even with enabledAt kept from an earlier spell on', () => {
    expect(candidates([order()], { enabled: false, enabledAtMs: ON }).size).toBe(0);
    expect(candidates([order()], { enabled: true, enabledAtMs: ON }).size).toBe(1);
  });
});

describe('+tag and case are one person (T366)', () => {
  it('groups checkouts across +tags under the bare address', () => {
    const c = candidates([order({ id: 'a', email: 'Ada+kgc@Company.com' }), order({ id: 'b', closedAtMs: ON + 2 * H })], { enabled: true, enabledAtMs: ON });
    expect([...c.keys()]).toEqual(['ada@company.com']);
    expect(c.get('ada@company.com')?.id).toBe('b');
  });

  it('counts a purchase or a pending invoice under any +tag or case', () => {
    const paid = order({ id: 'p', email: 'ADA@company.com', status: 'paid' });
    expect(orderFacts([paid], 'ada+kgc@company.com')).toEqual({ bought: true, invoicePending: false });
    expect(orderFacts([order({ email: 'ada+x@company.com', status: 'partially_refunded' })], 'ada@company.com').bought).toBe(true);
    expect(orderFacts([order({ email: 'ada@company.com', status: 'refunded' })], 'ada@company.com').bought).toBe(false);
    const invoice = order({ email: 'ada@company.com', status: 'pending', channel: 'invoice' });
    expect(orderFacts([invoice], 'Ada+kgc@company.com')).toEqual({ bought: false, invoicePending: true });
    expect(orderFacts([order({ email: 'ada@company.com', status: 'pending', channel: 'checkout' })], 'ada@company.com').invoicePending).toBe(false);
  });

  it('looks a person up as typed and without the tag', () => {
    expect(lookupAddresses('Ada+kgc@X.com')).toEqual(['ada+kgc@x.com', 'ada@x.com']);
    expect(lookupAddresses('ada@x.com')).toEqual(['ada@x.com']);
  });
});

describe('test addresses', () => {
  it('skips example domains, +test and the skip list, ignoring +tags', () => {
    expect(testAddressReason('x@example.com', [])).toBe('test address');
    expect(testAddressReason('x@example.org', [])).toBe('test address');
    expect(testAddressReason('ada+test1@gmail.com', [])).toBe('test address');
    expect(testAddressReason('hartigandeely+t167@gmail.com', [])).toBe('on the skip list');
    expect(testAddressReason('staff+x@kgc.test', ['staff@kgc.test'])).toBe('on the skip list');
    expect(testAddressReason('Owner@KGC.test', [], ['owner@kgc.test'])).toBe('on the skip list');
    expect(testAddressReason('ada@company.com', ['hartigandeely@gmail.com'])).toBeNull();
    expect(baseAddress('A+b+c@X.com')).toBe('a@x.com');
  });
});

describe('decide', () => {
  const due = ON + H + 24 * H;

  it('skips somebody waiting on an invoice, after "bought since"', () => {
    expect(decide(order(), { ...clean, invoicePending: true }, settings, due)).toMatchObject({ kind: 'skip', reason: 'invoice pending' });
    expect(decide(order(), { ...clean, bought: true, invoicePending: true }, settings, due)).toMatchObject({ reason: 'bought a ticket since' });
  });

  it('waits until the delay has passed, then sends', () => {
    expect(decide(order(), clean, settings, due - 1)).toMatchObject({ kind: 'wait', dueAtMs: due });
    expect(decide(order(), clean, settings, due)).toMatchObject({ kind: 'send', attempt: 1 });
  });

  it('skips with the reason, in order: bought since, test address, suppressed', () => {
    expect(decide(order(), { bought: true, suppressed: 'unsubscribed' }, settings, due)).toMatchObject({ kind: 'skip', reason: 'bought a ticket since' });
    expect(decide(order({ email: 'a@example.com' }), { bought: false, suppressed: 'bounced' }, settings, due)).toMatchObject({ kind: 'skip', reason: 'test address' });
    expect(decide(order(), { bought: false, suppressed: 'marked as spam' }, settings, due)).toMatchObject({ kind: 'skip', reason: 'marked as spam' });
  });

  it('never sends twice for the same checkout, or for an older one', () => {
    const sent = { status: 'sent' as const, orderId: 'ord_1', closedAtMs: ON + H, attempts: 1, sentAtMs: due };
    expect(decide(order(), { ...clean, reminder: sent }, settings, due + 90 * D).kind).toBe('done');
    expect(decide(order({ id: 'older', closedAtMs: ON }), { ...clean, reminder: sent }, settings, due + 90 * D).kind).toBe('done');
  });

  it('reminds a person once in 30 days, then again for a later checkout', () => {
    const sent = { status: 'sent' as const, orderId: 'ord_1', closedAtMs: ON + H, attempts: 1, sentAtMs: due };
    const later = order({ id: 'ord_2', closedAtMs: due + D });
    expect(decide(later, { ...clean, reminder: sent }, settings, due + 10 * D)).toMatchObject({ kind: 'skip', reason: 'reminded in the last 30 days' });
    expect(decide(later, { ...clean, reminder: sent }, settings, due + 31 * D)).toMatchObject({ kind: 'send', attempt: 1 });
  });

  it('leaves a claim in flight alone, and counts a dead one as a try', () => {
    const sending = { status: 'sending' as const, orderId: 'ord_1', closedAtMs: ON + H, attempts: 1, claimedAtMs: due };
    expect(decide(order(), { ...clean, reminder: sending }, settings, due + 1).kind).toBe('done');
    expect(decide(order(), { ...clean, reminder: sending }, settings, due + SENDING_LEASE_MS + 1)).toMatchObject({ kind: 'send', attempt: 2 });
  });

  it('retries a failed send at most twice', () => {
    const failed = (attempts: number) => ({ status: 'failed' as const, orderId: 'ord_1', closedAtMs: ON + H, attempts });
    expect(decide(order(), { ...clean, reminder: failed(1) }, settings, due)).toMatchObject({ kind: 'send', attempt: 2 });
    expect(decide(order(), { ...clean, reminder: failed(2) }, settings, due)).toMatchObject({ kind: 'send', attempt: 3 });
    expect(decide(order(), { ...clean, reminder: failed(MAX_ATTEMPTS) }, settings, due)).toMatchObject({ kind: 'done', note: 'not sent after 3 tries' });
  });

  it('does not let an old skip record block a person who is now due', () => {
    const skipped = { status: 'skipped' as const, orderId: 'ord_1', closedAtMs: ON + H, attempts: 0, reason: 'bounced' };
    expect(decide(order(), { ...clean, reminder: skipped }, settings, due).kind).toBe('send');
  });
});

describe('the Reminded column', () => {
  it('says what happened to this checkout', () => {
    expect(reminderCell('o', undefined)).toBeNull();
    expect(reminderCell('o', { status: 'sent', orderId: 'o', closedAtMs: 0, attempts: 1, sentAtMs: 5 })).toEqual({ text: 'Reminded', at: 5 });
    expect(reminderCell('o', { status: 'skipped', orderId: 'o', closedAtMs: 0, attempts: 0, reason: 'bounced' })?.text).toBe('Skipped: bounced');
    expect(reminderCell('o', { status: 'failed', orderId: 'o', closedAtMs: 0, attempts: 3 })?.text).toBe('Not sent after 3 tries');
    expect(reminderCell('o', { status: 'sent', orderId: 'other', closedAtMs: 0, attempts: 1, sentAtMs: 5 })?.text).toBe('Reminded for another checkout');
  });
});

describe('settings', () => {
  it('checks the form', () => {
    const ok = { delayHours: 24, subject: 'S', body: 'B', replyTo: 'contact@knowledgegraph.tech' };
    expect(checkSettings(ok)).toEqual([]);
    expect(checkSettings({ ...ok, delayHours: 0 })).toHaveLength(1);
    expect(checkSettings({ ...ok, delayHours: 1.5 })).toHaveLength(1);
    expect(checkSettings({ ...ok, subject: ' ', body: '', replyTo: 'nope' })).toHaveLength(3);
    expect(parseSkipList('A@x.com, b@y.com\nnot-an-address\na@x.com')).toEqual(['a@x.com', 'b@y.com']);
  });
});
