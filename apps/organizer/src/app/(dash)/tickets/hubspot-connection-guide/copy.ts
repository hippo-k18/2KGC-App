import { HUBSPOT_SCOPES } from '@kgc/scripts/src/lib/hubspot-core';

/**
 * Sentences the page and the actions both say, kept in one place so the
 * banner and a button's answer cannot drift apart. The e2e looks for them.
 */

/** A token is saved but this server cannot decrypt it. Not HubSpot's refusal. */
export const UNREADABLE_TOKEN =
  "The saved token can't be read on this server. Its encryption key (WEB_ORDER_SECRET) differs from the one it was saved with. Paste the token again.";

/** "a, b and c" */
export function listWords(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The token works but lacks scopes; `then` says what to do once they are added. */
export function missingScopesText(missing: readonly string[], then: string): string {
  const one = missing.length === 1;
  return `HubSpot accepted the token, but the app is missing ${one ? 'this scope' : 'these scopes'}: ${listWords(missing)}. Add ${one ? 'it' : 'them'} on the app's Scopes tab in HubSpot, then ${then}.`;
}

/** HubSpot would not say which scopes the token has, and the read checks passed. */
export const SCOPES_UNCONFIRMED = `The connection works, but HubSpot did not say which scopes the token has, so the write scopes could not be confirmed. Check that the app has all four: ${listWords(HUBSPOT_SCOPES)}.`;
