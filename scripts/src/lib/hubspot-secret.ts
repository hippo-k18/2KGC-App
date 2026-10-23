/**
 * The HubSpot token at rest (T333).
 *
 * This codebase keeps its secrets in env files on the droplet and has no
 * Secret Manager, but a token pasted into the dashboard has to live somewhere
 * both websites can read. So it is stored in Firestore (`integrations/hubspotSecret`,
 * a server-only collection with no rules match block) encrypted with
 * AES-256-GCM, under a key derived with HKDF from `WEB_ORDER_SECRET`, which both
 * apps already hold. A Firestore export or a leaked backup therefore does not
 * leak the token.
 *
 * ⚠️ Rotating `WEB_ORDER_SECRET` makes the stored token unreadable. The sync
 * then stops with "paste the token again", which is the safe failure.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

function key(): Buffer {
  const s = process.env.WEB_ORDER_SECRET;
  if (!s || s.length < 16) {
    throw new Error('WEB_ORDER_SECRET is missing or too short, so the HubSpot token cannot be stored or read.');
  }
  return Buffer.from(hkdfSync('sha256', s, 'kgc-integrations', 'hubspot-token-v1', 32));
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** `v1.<iv>.<tag>.<ciphertext>`, base64url. */
export function sealToken(token: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv, { authTagLength: TAG_BYTES });
  const ct = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

/**
 * The token, or null when the sealed value is malformed, tampered with, or
 * sealed under another key. The IV must be 12 bytes and the tag 16, and the
 * decipher is told the tag length, so a truncated tag (which GCM would
 * otherwise accept down to 4 bytes) is refused rather than checked weakly.
 */
export function openToken(sealed: unknown): string | null {
  if (typeof sealed !== 'string') return null;
  const parts = sealed.split('.');
  if (parts.length !== 4) return null;
  const [v, ivText, tagText, ctText] = parts;
  if (v !== 'v1' || !ivText || !tagText || !ctText) return null;
  const iv = Buffer.from(ivText, 'base64url');
  const tag = Buffer.from(tagText, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(ctText, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** What state the saved token is in, for the screen: none saved, readable, or saved but unreadable here. */
export function tokenState(sealed: unknown): 'none' | 'ok' | 'unreadable' {
  if (sealed === undefined || sealed === null) return 'none';
  return openToken(sealed) === null ? 'unreadable' : 'ok';
}
