/**
 * The abuse holes from the 2026-10-14 audits (T257, T258, T261, T262, T263),
 * replayed the way the auditors ran them, and shown closed (T264). Each block
 * also shows that one honest use still works.
 *
 * Run with: npm run test:abuse-limits
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** The request every server action sees. `xff` is the header Apache passes on. */
const req = vi.hoisted(() => {
  const r = { xff: '203.0.113.9', jar: new Map<string, string>() };
  return {
    ...r,
    state: r,
    headers: async () => new Headers({ host: 'www.example.test', 'x-forwarded-for': r.xff }),
    cookies: async () => ({
      get: (k: string) => (r.jar.has(k) ? { name: k, value: r.jar.get(k)! } : undefined),
      set: (k: string, v: string) => void r.jar.set(k, v),
      delete: (k: string) => void r.jar.delete(k),
    }),
  };
});
vi.mock('../../apps/web/node_modules/next/headers.js', () => ({ headers: req.headers, cookies: req.cookies }));
vi.mock('../../apps/organizer/node_modules/next/headers.js', () => ({ headers: req.headers, cookies: req.cookies }));
vi.mock('../../apps/web/node_modules/next/navigation.js', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { url });
  },
}));
vi.mock('../../apps/organizer/node_modules/next/navigation.js', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { url });
  },
}));

// The invoice form's outside world: Stripe, the sales switch and the mail.
const inv = vi.hoisted(() => ({ raised: [] as { billingEmail: string }[] }));
vi.mock('@/lib/stripe', () => ({ stripeEnabled: () => true }));
vi.mock('@/lib/data', () => ({ ticketSalesOpen: async () => true }));
vi.mock('@/lib/invoicing', () => ({
  InvoiceError: class extends Error {},
  raiseInvoice: async (r: { billingEmail: string }) => {
    inv.raised.push(r);
    return { invoiceId: `in_${inv.raised.length}`, totalCents: 1, hostedInvoiceUrl: 'https://invoice.stripe.com/i/x' };
  },
}));
vi.mock('@/lib/registrations', () => ({ recordInvoiceOrder: async () => {} }));
vi.mock('@/lib/email', () => ({ sendInvoiceRaised: async () => {} }));

import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { requestSignInCode as requestOtp } from '@kgc/scripts/src/lib/otp-core';
import { db as webDb } from '../../apps/web/src/lib/firestore';
import * as dash from '../../apps/organizer/src/lib/auth';
import * as ticket from '../../apps/web/src/lib/ticket-pass';
import * as blog from '../../apps/web/src/lib/blog/auth';
import { submitAction } from '../../apps/web/src/app/submit/actions';
import { requestInvoice } from '../../apps/web/src/app/tickets/invoice/actions';

let db: Firestore;
const sent: { to: string; subject: string; text: string }[] = [];
const realFetch = globalThis.fetch;

/** The last code mailed to `to`. */
function lastCode(to: string): string {
  const mail = [...sent].reverse().find((m) => m.to === to);
  const m = mail && /\b(\d{6})\b/.exec(mail.text);
  if (!m) throw new Error(`no code was mailed to ${to}`);
  return m[1];
}
/** Any six digits that are not the real code. */
const wrongCode = (real: string) => String((Number(real) + 1) % 1_000_000).padStart(6, '0');

async function wipe(name: string) {
  await db.recursiveDelete(db.collection(name));
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('FIRESTORE_EMULATOR_HOST is not set. Use: npm run test:abuse-limits');
  db = webDb() as unknown as Firestore;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith('https://api.resend.com/')) {
      const body = JSON.parse(String(init?.body));
      sent.push({ to: [].concat(body.to)[0], subject: body.subject, text: body.text ?? '' });
      return new Response(JSON.stringify({ id: `re_${sent.length}` }), { status: 200 });
    }
    throw new Error(`Unexpected request in a test: ${String(url)}`);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(async () => {
  process.env.RESEND_API_KEY = 're_test_key';
  sent.length = 0;
  inv.raised.length = 0;
  req.state.xff = '203.0.113.9';
  req.state.jar.clear();
  await Promise.all(
    [
      COLLECTIONS.rateLimits,
      COLLECTIONS.consoleSignInCodes,
      COLLECTIONS.ticketSignInCodes,
      COLLECTIONS.blogSignInCodes,
      COLLECTIONS.blogMembers,
      COLLECTIONS.otpCodes,
      COLLECTIONS.registrations,
      COLLECTIONS.emailLog,
      COLLECTIONS.submissions,
      COLLECTIONS.calls,
      COLLECTIONS.ticketTypes,
    ].map(wipe),
  );
});

// ── Dashboard sign-in (T263 P1, T258 #13, T262) ─────────────────────────────

describe('dashboard sign-in code', () => {
  const OWNER = 'owner@example.com';

  it('one honest sign-in still works', async () => {
    expect(await dash.requestSignInCode(OWNER)).toEqual({ ok: true, email: OWNER });
    const r = await dash.signInWithCode(OWNER, lastCode(OWNER));
    expect(r.ok).toBe(true);
  });

  it('the auditors\' loop (request, 5 wrong, burn the code, request again) is stopped', async () => {
    // The old floor was skipped once the spent code was deleted. Here every
    // round waits out the 30 s floor by clearing `sentAt`, which is the most an
    // attacker could ever get, and the loop still stops.
    let guesses = 0;
    let refusedAt: string | undefined;
    for (let round = 0; round < 10 && !refusedAt; round += 1) {
      await db.collection(COLLECTIONS.consoleSignInCodes).doc(OWNER).update({ sentAt: new Date(0) }).catch(() => {});
      const asked = await dash.requestSignInCode(OWNER);
      if (!asked.ok) {
        refusedAt = asked.error;
        break;
      }
      const real = lastCode(OWNER);
      for (let i = 0; i < 6; i += 1) {
        const r = await dash.signInWithCode(OWNER, wrongCode(real));
        if (!r.ok && r.error.startsWith('Too many wrong codes')) {
          refusedAt = r.error;
          break;
        }
        guesses += 1;
      }
    }
    expect(refusedAt).toBeDefined();
    // Ten wrong codes against live codes, then the lock. (The sixth try on each
    // spent code is not a guess at all.)
    expect(guesses).toBeLessThanOrEqual(12);
    // Locked: even the right code is refused now.
    await db.collection(COLLECTIONS.consoleSignInCodes).doc(OWNER).delete();
    const again = await dash.requestSignInCode(OWNER);
    expect(again.ok).toBe(false);
  });

  it('caps codes per address at five an hour, whatever IP the requests claim', async () => {
    let ok = 0;
    for (let i = 0; i < 8; i += 1) {
      req.state.xff = `10.0.0.${i}, 198.51.100.${i}`; // a different real IP each time
      await db.collection(COLLECTIONS.consoleSignInCodes).doc(OWNER).update({ sentAt: new Date(0) }).catch(() => {});
      if ((await dash.requestSignInCode(OWNER)).ok) ok += 1;
    }
    expect(ok).toBe(5);
    expect(sent.filter((m) => m.to === OWNER)).toHaveLength(5);
  });

  it('a spoofed X-Forwarded-For does not reset the per-IP lookup cap', async () => {
    let answered = 0;
    for (let i = 0; i < 35; i += 1) {
      req.state.xff = `1.2.3.${i}, 203.0.113.9`; // attacker-chosen first hop, same real IP
      const r = await dash.requestSignInCode(`nobody${i}@example.com`);
      if (!r.ok && r.error.startsWith('Email not recognised')) answered += 1;
    }
    expect(answered).toBe(30);
  });
});

// ── www ticket pass (T263 P1) ───────────────────────────────────────────────

describe('ticket pass code', () => {
  const HOLDER = 'holder@example.com';
  beforeEach(async () => {
    await db.collection(COLLECTIONS.registrations).doc('reg_holder').set({
      eventId: EVENT_ID,
      email: HOLDER,
      name: 'Hol Der',
      status: 'active',
      ticketType: 'Main Conference',
    });
  });

  it('one honest sign-in still works and sets the cookie', async () => {
    expect(await ticket.requestTicketCode(HOLDER)).toEqual({ ok: true, email: HOLDER });
    expect(await ticket.verifyTicketCode(HOLDER, lastCode(HOLDER))).toEqual({ ok: true });
    expect(req.state.jar.has(ticket.TICKET_PASS_COOKIE)).toBe(true);
  });

  it('brute force locks the address after ten wrong codes across codes', async () => {
    let locked = false;
    let guesses = 0;
    for (let round = 0; round < 6 && !locked; round += 1) {
      await db.collection(COLLECTIONS.ticketSignInCodes).doc(HOLDER).update({ sentAt: new Date(0) }).catch(() => {});
      await ticket.requestTicketCode(HOLDER);
      const real = lastCode(HOLDER);
      for (let i = 0; i < 5; i += 1) {
        const r = await ticket.verifyTicketCode(HOLDER, wrongCode(real));
        if (!r.ok && r.error.startsWith('Too many wrong codes')) {
          locked = true;
          break;
        }
        guesses += 1;
      }
    }
    expect(locked).toBe(true);
    expect(guesses).toBe(10);
  });

  it('cannot mail-bomb a holder: five codes an hour', async () => {
    for (let i = 0; i < 8; i += 1) {
      await db.collection(COLLECTIONS.ticketSignInCodes).doc(HOLDER).update({ sentAt: new Date(0) }).catch(() => {});
      await ticket.requestTicketCode(HOLDER);
    }
    expect(sent.filter((m) => m.to === HOLDER)).toHaveLength(5);
  });

  it('the cap answers the same for a stranger, so it does not reveal who holds a ticket', async () => {
    const answers: string[] = [];
    for (const who of [HOLDER, 'stranger@example.com']) {
      for (let i = 0; i < 6; i += 1) {
        await db.collection(COLLECTIONS.ticketSignInCodes).doc(who).update({ sentAt: new Date(0) }).catch(() => {});
        const r = await ticket.requestTicketCode(who);
        if (i === 5) answers.push(JSON.stringify(r).replace(who, 'X'));
      }
    }
    expect(answers[0]).toBe(answers[1]);
  });
});

// ── Blog editor (T263 P1) ───────────────────────────────────────────────────

describe('blog sign-in code', () => {
  const EDITOR = 'editor@example.com';

  it('one honest sign-in still works', async () => {
    expect(await blog.requestCode(EDITOR)).toEqual({ ok: true, email: EDITOR });
    expect(await blog.verifyCode(EDITOR, lastCode(EDITOR))).toEqual({ ok: true });
  });

  it('brute force locks the address after ten wrong codes across codes', async () => {
    let locked = false;
    let guesses = 0;
    for (let round = 0; round < 6 && !locked; round += 1) {
      await db.collection(COLLECTIONS.blogSignInCodes).doc(EDITOR).update({ sentAt: new Date(0) }).catch(() => {});
      const asked = await blog.requestCode(EDITOR);
      if (!asked.ok) {
        locked = asked.error.startsWith('Too many wrong codes');
        break;
      }
      const real = lastCode(EDITOR);
      for (let i = 0; i < 6; i += 1) {
        const r = await blog.verifyCode(EDITOR, wrongCode(real));
        if (!r.ok && r.error.startsWith('Too many wrong codes')) {
          locked = true;
          break;
        }
        if (i < 5) guesses += 1;
      }
    }
    expect(locked).toBe(true);
    expect(guesses).toBe(10);
  });
});

// ── App OTP daily cap (T263 P2) ─────────────────────────────────────────────

describe('app sign-in code', () => {
  it('fifteen codes a day per address, even spread over the hours', async () => {
    const email = 'attendee@example.com';
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      let ok = 0;
      const start = Date.now();
      for (let i = 0; i < 20; i += 1) {
        vi.setSystemTime(start + i * 61 * 60_000); // a new hour each time
        if ((await requestOtp(db, email, '203.0.113.9')).ok) ok += 1;
      }
      // 20 hours: the hourly cap never binds, the daily one stops it at 15.
      expect(ok).toBe(15);
    } finally {
      vi.useRealTimers();
    }
  });

  it('one honest request still works', async () => {
    expect(await requestOtp(db, 'one@example.com', '203.0.113.9')).toEqual({ ok: true });
  });
});

// ── CFP form relay (T261 #1, T263) ──────────────────────────────────────────

describe('CFP submit form', () => {
  beforeEach(async () => {
    const now = Date.now();
    await db.collection(COLLECTIONS.calls).doc('kgc-2027-abstracts').set({
      eventId: EVENT_ID,
      title: 'Call for Abstracts',
      instructions: 'Tell us what the work is.',
      status: 'published',
      timeZone: 'America/New_York',
      opensAtLocal: '2027-01-01T09:00',
      closesAtLocal: '2027-03-31T23:59',
      opensAt: new Date(now - 3_600_000),
      closesAt: new Date(now + 3_600_000),
      sessionTypes: ['talk', 'workshop'],
      trackIds: [],
      form: [],
      formVersion: 1,
      priorVersions: [],
      blindReview: 'single-blind',
      reviewsPerSubmission: 3,
      reminderDaysBefore: [7, 1],
    });
  });

  const draft = (email: string) => {
    const f = new FormData();
    f.set('callId', 'kgc-2027-abstracts');
    f.set('title', 'Buy cheap pills at evil.example');
    f.set('authorName', 'Victim');
    f.set('authorEmail', email);
    return f;
  };
  const save = async (f: FormData) => {
    try {
      return await submitAction({}, f);
    } catch (e) {
      return { redirect: (e as { url?: string }).url };
    }
  };

  it('T261\'s flood: six draft saves to one victim send one email, not six', async () => {
    for (let i = 0; i < 6; i += 1) {
      const r = await save(draft('victim@example.test'));
      expect(r).toHaveProperty('redirect');
    }
    expect(sent.filter((m) => m.to === 'victim@example.test')).toHaveLength(1);
  });

  it('caps saves per author address and per IP', async () => {
    let saved = 0;
    for (let i = 0; i < 12; i += 1) if ('redirect' in (await save(draft('victim2@example.test')))) saved += 1;
    expect(saved).toBe(10);

    let fromOneIp = 0;
    for (let i = 0; i < 35; i += 1) {
      req.state.xff = `9.9.9.${i}, 198.51.100.77`; // spoofed first hop, same real IP
      if ('redirect' in (await save(draft(`v${i}@example.test`)))) fromOneIp += 1;
    }
    expect(fromOneIp).toBe(30);
  });

  it('one honest draft saves and mails its link', async () => {
    const r = await save(draft('author@example.org'));
    expect((r as { redirect?: string }).redirect).toMatch(/^\/submit\/token\//);
    expect(sent.filter((m) => m.to === 'author@example.org')).toHaveLength(1);
  });
});

// ── Invoice form (T257 #1, T263) ────────────────────────────────────────────

describe('invoice form', () => {
  beforeEach(async () => {
    await db.collection(COLLECTIONS.ticketTypes).doc('main-conference').set({
      eventId: EVENT_ID,
      name: 'Main Conference',
      priceCents: 10_000,
      currency: 'usd',
      quantityTotal: 100,
      quantitySold: 0,
    });
  });

  const form = (billingEmail: string) => {
    const f = new FormData();
    f.set('company', 'Acme Corporation');
    f.set('billingEmail', billingEmail);
    f.set('addressLine1', '1 Main St');
    f.set('city', 'New York');
    f.set('state', 'NY');
    f.set('postalCode', '10018');
    f.set('country', 'US');
    f.set('netDays', '30');
    f.append('seatName', 'Ada Lovelace');
    f.append('seatEmail', 'ada@acme.example');
    f.append('seatTier', 'main-conference');
    return f;
  };
  const submit = async (f: FormData) => {
    try {
      return await requestInvoice({}, f);
    } catch (e) {
      return { redirect: (e as { url?: string }).url };
    }
  };

  it('one honest request raises one invoice', async () => {
    const r = await submit(form('ap@acme.example'));
    expect(r).toEqual({ redirect: 'https://invoice.stripe.com/i/x' });
    expect(inv.raised).toHaveLength(1);
  });

  it('T257\'s flood (12 submits, one billing email) raises three', async () => {
    for (let i = 0; i < 12; i += 1) await submit(form('sponsor-ap@example.com'));
    expect(inv.raised).toHaveLength(3);
  });

  it('cycling billing emails from one connection stops at the checkout IP limit', async () => {
    for (let i = 0; i < 15; i += 1) {
      req.state.xff = `5.5.5.${i}, 198.51.100.50`; // spoofed first hop, same real IP
      await submit(form(`ap${i}@example.com`));
    }
    expect(inv.raised).toHaveLength(10);
  });
});
