import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

import { headerText, sendInvoiceRaised, sendPurchaseConfirmation, sendRefundConfirmation } from './email.js';

/**
 * What `send()` does with the provider and with what it is given, against a
 * fake `fetch` and an in-memory `emailLog` (T135B, TK-222/227/228).
 */
const logged: Record<string, unknown>[] = [];
const store = {
  collection: () => ({ add: async (doc: Record<string, unknown>) => void logged.push(doc) }),
} as unknown as Firestore;

const requests: { subject: string; text: string; html: string }[] = [];

beforeEach(() => {
  logged.length = 0;
  requests.length = 0;
  vi.stubEnv('RESEND_API_KEY', 're_test_key');
  vi.stubEnv('RESEND_TIMEOUT_MS', '50');
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
