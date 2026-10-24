import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The Resend webhook's two pure halves: checking the signature and reading the
 * event. Apart from Firestore so both can be tested.
 *
 * Resend signs webhooks the Svix way: three headers, `svix-id`,
 * `svix-timestamp` and `svix-signature`, and an HMAC-SHA256 over
 * `${id}.${timestamp}.${body}` keyed with the base64 part of the `whsec_`
 * secret. The signature header may carry several `v1,<base64>` values,
 * space-separated, while a secret is being rotated.
 */

/** Older than this, a signed request is treated as a replay. Svix uses five minutes. */
export const SIGNATURE_TOLERANCE_S = 5 * 60;

export type VerifyResult = 'ok' | 'no-secret' | 'bad-signature' | 'stale';

export function verifySvixSignature(input: {
  secret: string | undefined;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowS?: number;
}): VerifyResult {
  // Fail closed: with no secret configured, nothing is trusted.
  if (!input.secret) return 'no-secret';
  if (!input.id || !input.timestamp || !input.signature) return 'bad-signature';

  const ts = Number(input.timestamp);
  const now = input.nowS ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > SIGNATURE_TOLERANCE_S) return 'stale';

  const key = Buffer.from(input.secret.replace(/^whsec_/, ''), 'base64');
  const want = createHmac('sha256', key).update(`${input.id}.${input.timestamp}.${input.body}`).digest();

  for (const part of input.signature.split(' ')) {
    const [version, value] = part.split(',', 2);
    if (version !== 'v1' || !value) continue;
    const given = Buffer.from(value, 'base64');
    if (given.length === want.length && timingSafeEqual(given, want)) return 'ok';
  }
  return 'bad-signature';
}

export interface DeliveryProblem {
  kind: 'bounced' | 'complained';
  /** Lower-cased recipient addresses. */
  emails: string[];
  /** Resend's message id: `emailLog.providerId`. */
  emailId?: string;
  at: Date;
}

/**
 * The event, if it is one this site acts on, or null.
 *
 * `email.bounced` and `email.complained` only. A bounce Resend calls
 * `Transient` (a full mailbox, a greylist) is not recorded: the next mail may
 * well arrive, and suppressing on it would drop people for a bad afternoon.
 */
export function readDeliveryProblem(raw: unknown): DeliveryProblem | null {
  if (!raw || typeof raw !== 'object') return null;
  const event = raw as {
    type?: unknown;
    created_at?: unknown;
    data?: { email_id?: unknown; to?: unknown; bounce?: { type?: unknown } };
  };
  const kind =
    event.type === 'email.bounced' ? 'bounced' : event.type === 'email.complained' ? 'complained' : null;
  if (!kind) return null;
  if (kind === 'bounced' && String(event.data?.bounce?.type ?? '').toLowerCase() === 'transient') return null;

  const to = event.data?.to;
  const emails = (Array.isArray(to) ? to : typeof to === 'string' ? [to] : [])
    .filter((e): e is string => typeof e === 'string')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes('@'));
  if (emails.length === 0) return null;

  const created = typeof event.created_at === 'string' ? new Date(event.created_at) : new Date();
  return {
    kind,
    emails,
    emailId: typeof event.data?.email_id === 'string' ? event.data.email_id : undefined,
    at: Number.isNaN(created.getTime()) ? new Date() : created,
  };
}
