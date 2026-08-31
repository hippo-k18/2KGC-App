import 'server-only';

/**
 * The `/u/{token}` capability token.
 *
 * Re-exported from `@kgc/scripts` for exactly the reason `order-token.ts` is:
 * the mail that carries this link is composed in the organizer dashboard, and
 * the page that honours it is here. Two implementations of an HMAC are two
 * chances to disagree about the payload encoding, and the symptom of that would
 * be an unsubscribe link that silently fails to verify — which is worse than a
 * broken confirmation link, because the reader's next move is a spam complaint.
 *
 * `server-only` stays on this module so a mistaken client import is a build
 * error rather than a signing secret in a browser bundle.
 */
export {
  mintUnsubscribeToken,
  readUnsubscribeToken,
  type UnsubscribeTokenPayload,
} from '@kgc/scripts/src/lib/unsubscribe-token';
