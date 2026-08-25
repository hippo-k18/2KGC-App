import 'server-only';

/**
 * The `/order/{token}` capability token.
 *
 * Re-exported from `@kgc/scripts` rather than implemented here, because the
 * organizer dashboard mints the same token when it accepts a purchase order out
 * of band and emails the attendees their confirmation. Two implementations of
 * an HMAC are two chances to disagree about the payload encoding — and the
 * symptom of that would be a confirmation link that silently fails to verify.
 *
 * `server-only` stays on this module so a mistaken client import is a build
 * error rather than a signing secret in a browser bundle.
 */
export {
  mintOrderToken,
  readOrderToken,
  type OrderTokenPayload,
} from '@kgc/scripts/src/lib/order-token';
