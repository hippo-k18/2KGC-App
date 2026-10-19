import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

import {
  backoffMs,
  closesLabel,
  headerText,
  idempotencyKeyFor,
  retryableStatus,
  sendBlogSignInCode,
  sendBulkMessage,
  sendInvoiceRaised,
  sendPurchaseConfirmation,
  sendRefundConfirmation,
  sendSignInCode,
  sendSubmissionReceipt,
} from './email.js';

/**
 * What `send()` does with the provider and with what it is given, against a
 * fake `fetch` and an in-memory `emailLog` (T135B, TK-222/227/228).
 */
const logged: Record<string, unknown>[] = [];
const store = {
  collection: () => ({ add: async (doc: Record<string, unknown>) => void logged.push(doc) }),
} as unknown as Firestore;

const requests: { from: string; reply_to: string; subject: string; text: string; html: string }[] = [];

beforeEach(() => {
  logged.length = 0;
  requests.length = 0;
  vi.stubEnv('RESEND_API_KEY', 're_test_key');
  vi.stubEnv('RESEND_TIMEOUT_MS', '50');
  // Pacing and backoff are real in production; here they would only slow the suite.
  vi.stubEnv('RESEND_MAX_PER_SECOND', '1000');
  vi.stubEnv('RESEND_RETRY_BASE_MS', '1');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function provider(answer: 'ok' | 'hang') {
  vi.stubGlobal('fetch', (_url: string, init: { body: string; signal?: AbortSignal }) => {
    requests.push(JSON.parse(init.body));
    if (answer === 'ok') return Promise.resolve(new Response(JSON.stringify({ id: 'em_1' }), { status: 200 }));
    // Accepts the connection and never answers, except to an abort.
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    });
  });
}

const refund = (name: string) =>
  sendRefundConfirmation(store, { to: 'ada@example.com', name, amountCents: 10_000, currency: 'usd' });

describe('a provider that never answers (TK-222)', () => {
  it('counts as failed within the timeout, and the failure is logged', async () => {
    provider('hang');
    const started = Date.now();
    expect(await refund('Ada Nakamura')).toBe('failed');
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ status: 'failed' });
  });
});

describe('names in greetings (TK-228)', () => {
  it.each([
    ['  Ada Nakamura', 'Hi Ada,'],
    ['Ada   Nakamura ', 'Hi Ada,'],
    ['   ', 'Hi,'],
  ])('greets %j as %j', async (name, greeting) => {
    provider('ok');
    expect(await refund(name)).toBe('sent');
    expect(requests[0].text.startsWith(greeting)).toBe(true);
    expect(requests[0].html).toContain(greeting);
    expect(requests[0].text).not.toContain('Hi ,');
  });
});

describe('header text (TK-227)', () => {
  it('turns line breaks and other control characters into single spaces', () => {
    expect(headerText('Acme\r\nBcc: victim@example.com')).toBe('Acme Bcc: victim@example.com');
    expect(headerText('  Acme\tCorp\u0000 ')).toBe('Acme Corp');
  });

  it('is applied to every subject that goes to the provider and the log', async () => {
    provider('ok');
    await sendInvoiceRaised(store, {
      to: 'ap@acme.example',
      companyName: 'Acme\r\nBcc: victim@example.com',
      seatCount: 2,
      totalCents: 20_000,
      currency: 'usd',
      hostedInvoiceUrl: 'https://invoice.stripe.com/i/x',
    });
    expect(requests[0].subject).not.toMatch(/[\r\n]/);
    expect(logged[0].subject).not.toMatch(/[\r\n]/);
  });
});

describe('Workshops added to an existing ticket (T169)', () => {
  it('says it was added, names the whole badge, and promises no new QR code', async () => {
    provider('ok');
    expect(
      await sendPurchaseConfirmation(store, {
        to: 'ada@example.com',
        name: 'Ada Nakamura',
        ticketType: 'Main Conference + Workshops',
        amountCents: 19_900,
        currency: 'usd',
        orderUrl: 'https://www.knowledgegraph.tech/order/abc',
        claimCode: '',
        addedExtra: 'Workshops',
      }),
    ).toBe('sent');
    expect(requests[0].subject).toBe('Workshops added to your Knowledge Graph Conference ticket');
    expect(requests[0].text).toContain('Workshops is now on your ticket');
    expect(requests[0].text).toContain('Ticket:        Main Conference + Workshops');
    expect(requests[0].text).toContain('same badge and QR code');
    expect(requests[0].text).not.toContain('Bring your team');
    expect(logged[0]).toMatchObject({ template: 'extra-added' });
  });

  it('a refund of Workshops alone says the Main Conference ticket still scans', async () => {
    provider('ok');
    await sendRefundConfirmation(store, {
      to: 'ada@example.com',
      name: 'Ada',
      ticketType: 'Workshops',
      amountCents: 19_900,
      currency: 'usd',
      ticketCancelled: false,
      extraRemoved: { name: 'Workshops', remaining: 'Main Conference' },
    });
    expect(requests[0].text).toContain('Workshops is no longer on your ticket. Your Main Conference ticket is not');
    expect(requests[0].text).not.toContain('Another order still covers it');
  });

  it('a refund of Main Conference keeps the badge for Workshops (T186)', async () => {
    provider('ok');
    await sendRefundConfirmation(store, {
      to: 'ada@example.com',
      name: 'Ada',
      ticketType: 'Main Conference',
      amountCents: 59_900,
      currency: 'usd',
      ticketCancelled: false,
      extraRemoved: { name: 'Main Conference', remaining: 'Workshops' },
    });
    expect(requests[0].text).toContain('Main Conference is no longer on your ticket. Your Workshops ticket is not');
    expect(requests[0].text).not.toContain('refunded separately');
    expect(requests[0].text).not.toContain('now cancelled');
  });
});

/**
 * T258 #1-3: no pacing, no retry on 429, and no idempotency key, so a 429 was
 * a lost mail and a late 200 was a double one.
 */
describe('retries, idempotency and pacing (T258 #3)', () => {
  type Seen = { headers: Record<string, string>; body: string };
  const seen: Seen[] = [];
  function scripted(answers: Array<number | 'hang'>) {
    seen.length = 0;
    let i = 0;
    vi.stubGlobal('fetch', (_url: string, init: { body: string; headers: Record<string, string>; signal?: AbortSignal }) => {
      seen.push({ headers: init.headers, body: init.body });
      const answer = answers[Math.min(i++, answers.length - 1)];
      if (answer === 'hang') {
        return new Promise((_r, reject) => init.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
      }
      return Promise.resolve(
        new Response(answer === 200 ? JSON.stringify({ id: 'em_ok' }) : '{"name":"rate_limit_exceeded"}', { status: answer }),
      );
    });
  }

  it('retries a 429 and a 500, then logs one sent row with the attempt count', async () => {
    scripted([429, 500, 200]);
    expect(await refund('Ada')).toBe('sent');
    expect(seen).toHaveLength(3);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ status: 'sent', providerId: 'em_ok', attempts: 3 });
  });

  it('retries a timeout under the same key and body, so Resend can answer with the first result', async () => {
    scripted(['hang', 200]);
    expect(await refund('Ada')).toBe('sent');
    expect(seen).toHaveLength(2);
    expect(seen[0].headers['Idempotency-Key']).toMatch(/^kgc-[0-9a-f]{48}$/);
    expect(seen[1].headers['Idempotency-Key']).toBe(seen[0].headers['Idempotency-Key']);
    expect(seen[1].body).toBe(seen[0].body);
  });

  it('does not retry a 422, which will fail the same way every time', async () => {
    scripted([422, 200]);
    expect(await refund('Ada')).toBe('failed');
    expect(seen).toHaveLength(1);
    expect(logged[0]).toMatchObject({ status: 'failed' });
  });

  it('gives up after the attempt limit and says so', async () => {
    vi.stubEnv('RESEND_MAX_ATTEMPTS', '3');
    scripted([429]);
    expect(await refund('Ada')).toBe('failed');
    expect(seen).toHaveLength(3);
    expect(String(logged[0].error)).toContain('after 3 attempts');
  });

  it('classifies statuses', () => {
    expect(retryableStatus(429, '')).toBe(true);
    expect(retryableStatus(503, '')).toBe(true);
    expect(retryableStatus(409, '{"name":"concurrent_idempotent_requests"}')).toBe(true);
    expect(retryableStatus(409, '{"name":"invalid_idempotent_request"}')).toBe(false);
    expect(retryableStatus(403, '')).toBe(false);
  });

  it('honours Retry-After and caps every wait', () => {
    expect(backoffMs(1, 3_000)).toBe(3_000);
    expect(backoffMs(1, 600_000)).toBe(20_000);
    const first = backoffMs(1, null, 1_000);
    expect(first).toBeGreaterThanOrEqual(750);
    expect(first).toBeLessThanOrEqual(1_250);
  });

  it('builds one key per (template, key, recipient), case-folded on the address', () => {
    const a = idempotencyKeyFor('bulk-message', 'campaign_1', 'Ada@Example.com');
    expect(a).toBe(idempotencyKeyFor('bulk-message', 'campaign_1', 'ada@example.com '));
    expect(a).not.toBe(idempotencyKeyFor('bulk-message', 'campaign_2', 'ada@example.com'));
    expect(a).not.toBe(idempotencyKeyFor('consent-request', 'campaign_1', 'ada@example.com'));
    expect(a).not.toContain('ada');
  });

  it('gives two separate calls with no key two different keys, so a deliberate re-send still goes', async () => {
    scripted([200]);
    await refund('Ada');
    await refund('Ada');
    expect(seen[0].headers['Idempotency-Key']).not.toBe(seen[1].headers['Idempotency-Key']);
  });

  it('paces requests under the configured rate', async () => {
    vi.stubEnv('RESEND_MAX_PER_SECOND', '10');
    scripted([200]);
    await new Promise((r) => setTimeout(r, 150)); // let any earlier slot pass
    const started = Date.now();
    for (let i = 0; i < 4; i++) await refund('Ada');
    // Four requests at 10 a second: at least three 100ms gaps.
    expect(Date.now() - started).toBeGreaterThanOrEqual(280);
  });
});

describe('bulk mail and the unsubscribe link (T258 #10, #11)', () => {
  const withContact = (exists: boolean) =>
    ({
      collection: (name: string) => ({
        add: async (doc: Record<string, unknown>) => void logged.push(doc),
        doc: () => ({ get: async () => ({ exists, data: () => ({}) }) }),
        name,
      }),
    }) as unknown as Firestore;

  it('refuses campaign mail when the address has no contact, so no unsubscribe link', async () => {
    scripted200();
    const outcome = await sendBulkMessage(withContact(false), {
      to: 'ada@example.com',
      subject: 'Tickets',
      body: 'Tickets are open.',
      campaignId: 'campaign_x',
      actor: 'owner@example.com',
      requireUnsubscribe: true,
    });
    expect(outcome).toBe('failed');
    expect(requests).toHaveLength(0);
    expect(logged[0]).toMatchObject({ status: 'failed', campaignId: 'campaign_x' });
  });

  it('refuses campaign mail when the link cannot be signed', async () => {
    vi.stubEnv('WEB_UNSUBSCRIBE_SECRET', '');
    vi.stubEnv('WEB_ORDER_SECRET', '');
    scripted200();
    const outcome = await sendBulkMessage(withContact(true), {
      to: 'ada@example.com',
      subject: 'Tickets',
      body: 'Tickets are open.',
      campaignId: 'campaign_x',
      actor: 'owner@example.com',
      requireUnsubscribe: true,
    });
    expect(outcome).toBe('failed');
    expect(requests).toHaveLength(0);
  });

  it('builds identical mail for a resumed campaign, and prints the postal address', async () => {
    vi.stubEnv('WEB_UNSUBSCRIBE_SECRET', 'a-test-secret-of-enough-length');
    vi.stubEnv('EMAIL_POSTAL_ADDRESS', 'KGC, 123 Example St, New York, NY 10001');
    scripted200();
    const input = {
      to: 'ada@example.com',
      name: 'Ada',
      subject: 'Tickets',
      body: 'Tickets are open.',
      campaignId: 'campaign_x',
      issuedAt: 1_700_000_000_000,
      actor: 'owner@example.com',
      requireUnsubscribe: true,
    };
    expect(await sendBulkMessage(withContact(true), input)).toBe('sent');
    expect(await sendBulkMessage(withContact(true), input)).toBe('sent');
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[0])).toBe(JSON.stringify(requests[1]));
    expect(requests[0].text).toContain('123 Example St');
    expect(requests[0].html).toContain('123 Example St');
    expect(requests[0].html).not.toContain('—');
  });

  function scripted200() {
    vi.stubGlobal('fetch', (_url: string, init: { body: string }) => {
      requests.push(JSON.parse(init.body));
      return Promise.resolve(new Response(JSON.stringify({ id: 'em_1' }), { status: 200 }));
    });
  }
});

describe('template copy (T258 #18, T259 #2)', () => {
  it('drops a close date that is not a date', () => {
    expect(closesLabel('the call closes')).toBeNull();
    expect(closesLabel(' ()')).toBeNull();
    expect(closesLabel('')).toBeNull();
    expect(closesLabel('1 March 2027')).toBe('1 March 2027');
  });

  it('never prints "Closes: the call closes"', async () => {
    provider('ok');
    await sendSubmissionReceipt(store, {
      to: 'ada@example.com',
      callTitle: 'KGC 2027',
      title: 'Graphs',
      link: 'https://www.knowledgegraph.tech/submit/token/x',
      closesAtLabel: 'the call closes',
      draft: true,
    });
    expect(requests[0].text).not.toContain('Closes:');
    expect(requests[0].text).toContain('before the call closes');
    expect(requests[0].html).not.toContain('—');
  });

  it('puts the badge QR in the app, not on the order page', async () => {
    provider('ok');
    await sendPurchaseConfirmation(store, {
      to: 'ada@example.com',
      name: 'Ada',
      ticketType: 'Main Conference',
      amountCents: 79_900,
      currency: 'usd',
      orderUrl: 'https://www.knowledgegraph.tech/order/x',
      claimCode: 'ABC123',
      referralCode: null,
    });
    for (const part of [requests[0].text, requests[0].html]) {
      expect(part).toContain('badge QR code is in the KGC app');
      expect(part).toContain('registration desk');
      expect(part).not.toMatch(/shows (your|the) badge QR/);
    }
  });
});

describe('the sender (T275)', () => {
  it('is contact@ for every kind of email, even where the env still names hello@', async () => {
    vi.stubEnv('EMAIL_FROM', 'Knowledge Graph Conference <hello@knowledgegraph.tech>');
    vi.stubEnv('EMAIL_REPLY_TO', 'hello@knowledgegraph.tech');
    provider('ok');
    await refund('Ada Nakamura');
    await sendPurchaseConfirmation(store, {
      to: 'ada@example.com',
      name: 'Ada Nakamura',
      ticketType: 'Main Conference',
      amountCents: 19_900,
      currency: 'usd',
      orderUrl: 'https://www.knowledgegraph.tech/order/abc',
      claimCode: '',
    });
    await sendSignInCode(store, { to: 'ada@example.com', code: '123456', ttlMinutes: 10 });
    await sendBlogSignInCode(store, { to: 'ada@example.com', code: '123456', expiresLabel: '10 minutes', surface: 'ticket' });
    await sendBulkMessage(store, { to: 'ada@example.com', subject: 'Hello', body: 'Hi.', campaignId: 'c1', actor: 'x' });
    expect(requests).toHaveLength(5);
    for (const r of requests) {
      expect(r.from).toBe('Knowledge Graph Conference <contact@knowledgegraph.tech>');
      expect(r.reply_to).toBe('contact@knowledgegraph.tech');
      expect(`${r.text}\n${r.html}`).not.toContain('hello@');
      expect(`${r.text}\n${r.html}`).not.toContain("don't reply");
    }
    expect(requests[1].text).toContain('Questions? Reply to this email or write to contact@knowledgegraph.tech.');
    expect(requests[1].html).toContain('Questions? Reply to this email or write to <a href="mailto:contact@knowledgegraph.tech"');
  });
});
