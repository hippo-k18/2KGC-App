import { cleanUtms, parseReferralCode, type ReferralUtm } from '@kgc/scripts/src/lib/referral-codes';

/**
 * Carrying an attendee's invite from the landing page to the new registration.
 *
 * The personal link in the confirmation email is
 * `/tickets?ref=KGC27-7QF2&utm_source=attendee&utm_medium=invite&utm_campaign=kgc2027`.
 * The middleware copies `ref` and the UTMs into first-party cookies, checkout
 * reads them back into Stripe metadata, and the webhook hands them to
 * fulfilment, which stamps `referredBy`. A query parameter alone would not
 * survive the visitor reading the agenda before buying; a form field would be
 * one the visitor can edit.
 *
 * Kept apart from the tracked-link cookie (`kgc_ref`, set by `/r/{code}`): that
 * credits an organizer's campaign on the order, this credits an attendee on the
 * registration, and a buyer can have arrived through both.
 *
 * Edge-safe: the middleware imports this, so nothing here may touch Node.
 */

export const REFERRAL_COOKIE = 'kgc_invite';
export const UTM_COOKIE = 'kgc_utm';
/** Thirty days, the same window as the tracked-link cookie. */
export const REFERRAL_MAX_AGE = 60 * 60 * 24 * 30;

export interface CapturedReferral {
  referralCode?: string;
  utm?: ReferralUtm;
}

/**
 * The cookies a landing URL should set. A malformed `ref` sets nothing, so it
 * cannot overwrite a good code from an earlier visit.
 */
export function referralCookiesFrom(params: URLSearchParams): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  const code = parseReferralCode(params.get('ref'));
  if (code) out.push({ name: REFERRAL_COOKIE, value: code });
  const utm = cleanUtms({
    source: params.get('utm_source'),
    medium: params.get('utm_medium'),
    campaign: params.get('utm_campaign'),
  });
  if (utm) out.push({ name: UTM_COOKIE, value: new URLSearchParams(utm as Record<string, string>).toString() });
  return out;
}

/** Read the cookies back, re-validated: a cookie arrives from the browser. */
export function readReferralCookies(get: (name: string) => string | undefined): CapturedReferral {
  const referralCode = parseReferralCode(get(REFERRAL_COOKIE)) ?? undefined;
  const raw = new URLSearchParams(get(UTM_COOKIE) ?? '');
  const utm = cleanUtms({ source: raw.get('source'), medium: raw.get('medium'), campaign: raw.get('campaign') });
  return { ...(referralCode ? { referralCode } : {}), ...(utm ? { utm } : {}) };
}

/**
 * Stripe metadata for a checkout session. Only keys with a value, because
 * Stripe rejects `undefined` and an empty string would read as "set".
 */
export function referralMetadata(captured: CapturedReferral): Record<string, string> {
  const meta: Record<string, string> = {};
  if (captured.referralCode) meta.referralCode = captured.referralCode;
  if (captured.utm?.source) meta.utmSource = captured.utm.source;
  if (captured.utm?.medium) meta.utmMedium = captured.utm.medium;
  if (captured.utm?.campaign) meta.utmCampaign = captured.utm.campaign;
  return meta;
}

/** The same values back out of a completed session's metadata, re-validated. */
export function referralFromMetadata(meta: Record<string, string> | null | undefined): CapturedReferral {
  const referralCode = parseReferralCode(meta?.referralCode) ?? undefined;
  const utm = cleanUtms({ source: meta?.utmSource, medium: meta?.utmMedium, campaign: meta?.utmCampaign });
  return { ...(referralCode ? { referralCode } : {}), ...(utm ? { utm } : {}) };
}
