import { describe, expect, it } from 'vitest';

import { describeAction } from './audit-action';

describe('describeAction', () => {
  it('reads the website’s warnings as whole phrases, not "Undeliveredd" (T135B, TK-300)', () => {
    expect(describeAction('confirmation.undelivered')).toBe('Confirmation email could not be delivered');
    expect(describeAction('invoice.oversold')).toBe('Invoice paid for more seats than were left');
    expect(describeAction('checkout.notFromWebsite')).toBe('Stripe payment not from ticketing (ignored)');
  });

  it('never invents a past tense for a verb that does not end in "e"', () => {
    expect(describeAction('order.seats')).toBe('Order: seats');
    expect(describeAction('checkout.return')).toBe('Checkout: return');
    expect(describeAction('referral.record')).toBe('Referral: record');
    expect(describeAction('attendee.leadLinkSend')).toBe('Sent the lead link for attendee');
  });

  it('still conjugates the regular verbs it always did', () => {
    expect(describeAction('attendee.reinstate')).toBe('Reinstated attendee');
    expect(describeAction('questionForm.update')).toBe('Updated question form');
    expect(describeAction('order.refund')).toBe('Refunded order');
  });
});
