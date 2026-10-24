import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The blog editor's session cookie and sign-in code hashes. Pure functions of a
 * secret, so `auth-core.test.ts` can check them without a request.
 *
 * The cookie is `payload.mac`: base64url JSON, then an HMAC-SHA256 of it. It
 * names an address, an expiry and the member's `sessionEpoch` at sign-in. It
 * decides nothing by itself: `auth.ts` re-reads the member on every request, so
 * removing someone or changing their role ends a session already in a browser.
 */

export interface BlogSession {
  email: string;
  expiresAt: number;
  epoch: string;
}

const mac = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(payload).digest('base64url');

export function encodeSession(secret: string, session: BlogSession): string {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  return `${payload}.${mac(secret, payload)}`;
}

export function decodeSession(secret: string, token: string | undefined, now = Date.now()): BlogSession | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(mac(secret, payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as BlogSession;
    if (typeof s.email !== 'string' || typeof s.epoch !== 'string' || !(s.expiresAt > now)) return null;
    return s;
  } catch {
    return null;
  }
}

/** A sign-in code as stored: never the code, and bound to the address it was sent to. */
export function hashCode(secret: string, email: string, code: string): string {
  return createHash('sha256').update(`${secret}\u0000${email}\u0000${code}`).digest('hex');
}

export function codesMatch(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function normaliseEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  // No slash: the address is a Firestore document id.
  return /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email) && email.length <= 254 ? email : null;
}
