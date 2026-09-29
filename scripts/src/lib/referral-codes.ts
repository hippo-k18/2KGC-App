/**
 * The pure half of referral codes: parsing, the personal link and the invite
 * email. No Node or Firestore imports, because the website's middleware runs on
 * the Edge runtime and reads `?ref=` with these. The Firestore half, and the
 * story of what referral codes are for, is `referrals.ts`.
 */

export const REFERRAL_PREFIX = 'KGC27-';

/** No 0/O, 1/I/L: a code read aloud or copied off a phone must not be ambiguous. */
export const REFERRAL_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

const CODE_PATTERN = new RegExp(`^${REFERRAL_PREFIX}[${REFERRAL_ALPHABET}]{4,6}$`);

/** The UTMs on every personal invite link (Min, 2026-09-28). */
export const INVITE_UTM = {
  utm_source: 'attendee',
  utm_medium: 'invite',
  utm_campaign: 'kgc2027',
} as const;

/**
 * A code from a URL or a cookie, or null. Case and surrounding space are
 * forgiven, since people retype links; anything else is refused before it is
 * used as a document id.
 */
export function parseReferralCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

/** A `utm_*` value fit to store, or undefined. Short and plain, nothing else. */
export function cleanUtm(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  return /^[\w.+-]{1,64}$/.test(value) ? value : undefined;
}

export interface ReferralUtm {
  source?: string;
  medium?: string;
  campaign?: string;
}

export function cleanUtms(raw: { source?: unknown; medium?: unknown; campaign?: unknown }): ReferralUtm | undefined {
  const utm: ReferralUtm = {};
  const source = cleanUtm(raw.source);
  const medium = cleanUtm(raw.medium);
  const campaign = cleanUtm(raw.campaign);
  if (source) utm.source = source;
  if (medium) utm.medium = medium;
  if (campaign) utm.campaign = campaign;
  return Object.keys(utm).length ? utm : undefined;
}

/** The personal link: the tickets page, with the code and the invite UTMs. */
export function personalInviteUrl(origin: string, code: string): string {
  const params = new URLSearchParams({ ref: code, ...INVITE_UTM });
  return `${origin.replace(/\/$/, '')}/tickets?${params.toString()}`;
}

export function firstNameOf(name: string | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/** Min's wording, verbatim (2026-09-28). */
export const INVITE_SUBJECT = 'Join me to the Knowledge Graph Conference 2027!';

export function inviteBody(link: string, firstName: string): string {
  const lines = [
    'Hi,',
    '',
    'I am going to the Knowledge Graph Conference in New York, 3 to 7 May 2027, and I would love you to join me. ' +
      'It is where the people building knowledge graphs and AI systems compare notes: talks, workshops, and a lot ' +
      'of hallway conversation that is hard to get anywhere else.',
    '',
    `Programme and tickets are here: ${link}`,
  ];
  if (firstName) lines.push('', firstName);
  return lines.join('\n');
}

/**
 * A `mailto:` with no recipient, so the attendee only adds the addresses.
 *
 * `encodeURIComponent`, not `URLSearchParams`: the latter writes a space as `+`,
 * which mail clients show literally. Line breaks go as CRLF, which RFC 6068
 * asks for and every client accepts.
 */
export function inviteMailto(link: string, firstName: string): string {
  const body = inviteBody(link, firstName).replace(/\n/g, '\r\n');
  return `mailto:?subject=${encodeURIComponent(INVITE_SUBJECT)}&body=${encodeURIComponent(body)}`;
}
