import { describe, expect, it } from 'vitest';

import { BODY_RETENTION_DAYS, MASK, MAX_BODY_CHARS, maskSecrets, storedBody } from './email-capture.js';

/**
 * What the Email Log keeps of a message (T274). The one property that must
 * never slip: a sign-in code is not in the stored copy, anywhere.
 */
const base = {
  from: 'Knowledge Graph Conference <hello@knowledgegraph.tech>',
  replyTo: 'info@knowledgegraph.tech',
  to: 'ada@example.com',
  subject: 'Your ticket',
  html: '<p style="color:#222222">Hi Ada</p>',
  text: 'Hi Ada',
  template: 'purchase-confirmation' as const,
};
const now = new Date('2026-10-18T12:00:00Z');

describe('masking', () => {
  it('replaces every copy of a named secret', () => {
    expect(maskSecrets('code 482913, again 482913', ['482913'])).toEqual({
      value: `code ${MASK}, again ${MASK}`,
      masked: true,
    });
  });

  it('ignores a secret too short to be one, so it cannot blank ordinary words', () => {
    expect(maskSecrets('a b c', ['a']).masked).toBe(false);
  });

  it('on code templates, masks any standalone six digits even when not named', () => {
    const r = storedBody({ ...base, template: 'sign-in-code', text: 'Your code: 123456. Valid 10 minutes.' }, now);
    expect(r.text).toBe(`Your code: ${MASK}. Valid 10 minutes.`);
    expect(r.masked).toBe(true);
  });

  it('leaves colours, years, prices and long numbers alone', () => {
    const text = 'color:#222222; May 2027; $1,199.00; order 12345678; 3-7 May';
    const r = storedBody({ ...base, template: 'sign-in-code', text, html: text }, now);
    expect(r.text).toBe(text);
    expect(r.html).toBe(text);
    expect(r.masked).toBeUndefined();
  });

  it('does not touch six digits in ordinary mail', () => {
    const r = storedBody({ ...base, text: 'Order 123456' }, now);
    expect(r.text).toBe('Order 123456');
  });

  it('masks the subject as well as the body', () => {
    const r = storedBody({ ...base, template: 'dashboard-sign-in-code', subject: '771204 is your KGC dashboard code', secrets: ['771204'] }, now);
    expect(r.subject).toBe(`${MASK} is your KGC dashboard code`);
  });
});

describe('size and retention', () => {
  it('keeps the text and drops the HTML of a message too large for one document', () => {
    const r = storedBody({ ...base, html: 'x'.repeat(MAX_BODY_CHARS), text: 'short' }, now);
    expect(r.html).toBe('');
    expect(r.text).toBe('short');
    expect(r.htmlDropped).toBe(true);
  });

  it('keeps an ordinary message whole', () => {
    const r = storedBody(base, now);
    expect(r.html).toBe(base.html);
    expect(r.htmlDropped).toBeUndefined();
  });

  it('expires after the retention period', () => {
    const r = storedBody(base, now);
    const days = ((r.expireAt as unknown as Date).getTime() - now.getTime()) / 86_400_000;
    expect(days).toBe(BODY_RETENTION_DAYS);
  });

  it('keeps the unsubscribe headers that were sent', () => {
    const headers = { 'List-Unsubscribe': '<https://x/u/1>' };
    expect(storedBody({ ...base, headers }, now).headers).toEqual(headers);
    expect(storedBody({ ...base, headers: {} }, now).headers).toBeUndefined();
  });
});
