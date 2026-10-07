/**
 * The pure half of attendee referrals: the code format, the personal link, the
 * invite `mailto:`, and carrying `ref` and the UTMs from the landing URL through
 * cookies and Stripe metadata. The Firestore half is
 * `tests/commerce/referrals.test.ts`.
 *
 * Run with: npm test
 */
import { describe, expect, it } from 'vitest';
import {
  INVITE_SUBJECT,
  REFERRAL_ALPHABET,
  cleanUtm,
  inviteBody,
  inviteMailto,
  mintReferralCode,
  parseReferralCode,
  personalInviteUrl,
} from '../../scripts/src/lib/referrals.js';
import {
  REFERRAL_COOKIE,
  UTM_COOKIE,
  readReferralCookies,
  referralCookiesFrom,
  referralFromMetadata,
  referralMetadata,
} from '../../apps/web/src/lib/referral-capture.js';
import { countReferrals, referralLeaderboard } from '../../apps/organizer/src/lib/referrals-core.js';

const LINK =
  'https://staging.knowledgegraph.tech/tickets?ref=KGC27-7QF2&utm_source=attendee&utm_medium=invite&utm_campaign=kgc2027';

describe('referral codes', () => {
  it('look like KGC27-XXXX and use only unambiguous characters', () => {
    for (let i = 0; i < 500; i += 1) {
      const code = mintReferralCode();
      expect(code).toMatch(/^KGC27-[A-Z0-9]{4}$/);
      for (const ch of code.slice(6)) expect(REFERRAL_ALPHABET).toContain(ch);
    }
    expect(REFERRAL_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it('spread across the alphabet rather than repeating', () => {
    const codes = new Set(Array.from({ length: 2000 }, () => mintReferralCode()));
    // 2,000 draws from 923,521: a handful of repeats at most.
    expect(codes.size).toBeGreaterThan(1990);
  });

  it('parse forgivingly and refuse anything that is not a code', () => {
    expect(parseReferralCode(' kgc27-7qf2 ')).toBe('KGC27-7QF2');
    expect(parseReferralCode('KGC27-7QF2AB')).toBe('KGC27-7QF2AB');
    for (const bad of ['', 'KGC27-', 'KGC27-7QF', 'KGC27-7QF2ABC', 'KGC27-0OIL', 'KGC26-7QF2', 'KGC27-7QF2/x', null, 42]) {
      expect(parseReferralCode(bad)).toBeNull();
    }
  });

  it('keep only plain, short UTM values', () => {
    expect(cleanUtm('attendee')).toBe('attendee');
    expect(cleanUtm(' kgc2027 ')).toBe('kgc2027');
    expect(cleanUtm('<script>')).toBeUndefined();
    expect(cleanUtm('x'.repeat(65))).toBeUndefined();
  });
});

describe('the personal link and the invite email', () => {
  it('goes to /tickets with the code and the three invite UTMs', () => {
    expect(personalInviteUrl('https://staging.knowledgegraph.tech/', 'KGC27-7QF2')).toBe(LINK);
  });

  it("is Min's wording with the link and the first name filled in", () => {
    expect(INVITE_SUBJECT).toBe('Join me to the Knowledge Graph Conference 2027!');
    const body = inviteBody(LINK, 'Ada');
    expect(body).toBe(
      'Hi,\n\nI am going to the Knowledge Graph Conference in New York, 3 to 7 May 2027, and I would love you to ' +
        'join me. It is where the people building knowledge graphs and AI systems compare notes: talks, workshops, ' +
        'and a lot of hallway conversation that is hard to get anywhere else.\n\n' +
        `Programme and tickets are here: ${LINK}\n\nAda`,
    );
    expect(inviteBody(LINK, '')).not.toMatch(/\n\n$/);
  });

  it('is a recipient-less mailto whose subject and body decode back exactly', () => {
    const mailto = inviteMailto(LINK, 'Ada');
    expect(mailto.startsWith('mailto:?subject=')).toBe(true);
    // A space must be %20: mail clients show a `+` literally.
    expect(mailto).not.toContain('+');
    // The link's own `&` must not split the mailto's query.
    expect(mailto.split('&')).toHaveLength(2);
    const params = new URL(mailto.replace('mailto:', 'http://x/'));
    expect(params.searchParams.get('subject')).toBe(INVITE_SUBJECT);
    expect(params.searchParams.get('body')).toBe(inviteBody(LINK, 'Ada').replace(/\n/g, '\r\n'));
    expect(mailto).toContain('%0D%0A');
  });
});

describe('carrying ref and UTMs from the landing page to the registration', () => {
  const landing = new URL(LINK).searchParams;

  it('sets a cookie for the code and one for the UTMs', () => {
    const set = referralCookiesFrom(landing);
    expect(set).toEqual([
      { name: REFERRAL_COOKIE, value: 'KGC27-7QF2' },
      { name: UTM_COOKIE, value: 'source=attendee&medium=invite&campaign=kgc2027' },
    ]);
  });

  it('sets nothing for a malformed code, so it cannot replace a good one', () => {
    expect(referralCookiesFrom(new URLSearchParams('ref=KGC27-0000'))).toEqual([]);
    expect(referralCookiesFrom(new URLSearchParams('ref=%3Cscript%3E'))).toEqual([]);
  });

  it('reads the cookies back, re-validated, into Stripe metadata and out again', () => {
    const jar = new Map(referralCookiesFrom(landing).map((c) => [c.name, c.value]));
    const captured = readReferralCookies((n) => jar.get(n));
    expect(captured).toEqual({
      referralCode: 'KGC27-7QF2',
      utm: { source: 'attendee', medium: 'invite', campaign: 'kgc2027' },
    });
    const meta = referralMetadata(captured);
    expect(meta).toEqual({
      referralCode: 'KGC27-7QF2',
      utmSource: 'attendee',
      utmMedium: 'invite',
      utmCampaign: 'kgc2027',
    });
    // Stripe caps a metadata value at 500 characters.
    for (const v of Object.values(meta)) expect(v.length).toBeLessThan(500);
    expect(referralFromMetadata(meta)).toEqual(captured);
  });

  it('drops a forged cookie and adds no empty metadata keys', () => {
    const captured = readReferralCookies((n) => (n === REFERRAL_COOKIE ? 'reg_abc/../x' : undefined));
    expect(captured).toEqual({});
    expect(referralMetadata(captured)).toEqual({});
    expect(referralFromMetadata({ referralCode: 'nope', name: 'Ada' })).toEqual({});
  });
});

describe('counting referrals for the dashboard', () => {
  const reg = (id: string, over: Record<string, unknown> = {}) =>
    ({ id, email: `${id}@example.com`, name: id, status: 'active', ...over }) as never;
  const by = (code: string) => ({ referredBy: { code, at: new Date() } });

  it('counts active referred tickets per referrer and ranks them', () => {
    const regs = [
      reg('ada', { referralCode: 'KGC27-AAAA' }),
      reg('ben', { referralCode: 'KGC27-BBBB', ...by('KGC27-AAAA') }),
      reg('cara', by('KGC27-AAAA')),
      reg('dan', { ...by('KGC27-AAAA'), status: 'cancelled' }),
      reg('eve', by('KGC27-BBBB')),
      // A code with no owner left credits nobody.
      reg('fay', by('KGC27-GONE')),
    ];
    expect(countReferrals(regs).get('KGC27-AAAA')).toBe(2);
    expect(countReferrals(regs).get('KGC27-BBBB')).toBe(1);
    expect(referralLeaderboard(regs).map((r) => [r.registrationId, r.code, r.referred])).toEqual([
      ['ada', 'KGC27-AAAA', 2],
      ['ben', 'KGC27-BBBB', 1],
    ]);
  });
});
