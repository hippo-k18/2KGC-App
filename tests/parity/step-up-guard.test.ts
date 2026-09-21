/**
 * The actions that ask for the passphrase again, asserted rather than trusted.
 *
 * ── Why this is a source-level test ─────────────────────────────────────────
 *
 * `reauthenticate()` reads a cookie and a hashed secret, so the actions that
 * call it cannot be loaded by Vitest at all — every one of them is a
 * `'use server'` module that pulls in `server-only` two imports down. The thing
 * worth pinning is not what `reauthenticate` returns, which `team-core.test.ts`
 * already covers, but *which* actions are behind it. That is a property of the
 * source, so the source is what is read. `tests/parity/storage-url.test.ts`
 * takes the same approach to the same kind of problem.
 *
 * ── What went wrong, and why the list is worth keeping ──────────────────────
 *
 * Refunds asked for the passphrase on the stated grounds that an eight-hour
 * session on an unattended laptop at a registration desk is the normal state of
 * a conference. The one action in this dashboard that **permanently destroys a
 * person** — their ticket, profile, messages, posts and sign-in account — did
 * not, and its only confirmation was typing an address printed on the same
 * screen. A refund can be reversed and an erasure cannot, so the irreversible
 * one was the weaker of the two.
 *
 * The consent send is on the list for a different reason: it cannot be recalled
 * either, and each mail carries a link that signs a legal release in somebody's
 * name.
 *
 * Run with: npm test — no emulator, no Java.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const GUARDED: { what: string; file: string; action: string }[] = [
  {
    what: 'deleting everything held about one person',
    file: 'apps/organizer/src/app/(dash)/attendees/manage-attendees/attendees/person-data-actions.ts',
    action: 'erasePersonAction',
  },
  {
    what: 'refunding an order',
    file: 'apps/organizer/src/app/(dash)/tickets/orders-and-transactions/attendee-orders/actions.ts',
    action: 'refundOrderAction',
  },
  {
    what: 'mailing a campaign to a contact list',
    file: 'apps/organizer/src/app/(dash)/tickets/ticket-marketing/email-campaign/actions.ts',
    action: 'sendCampaignAction',
  },
  {
    what: 'mailing the signing links for a consent form',
    file: 'apps/organizer/src/app/(dash)/attendees/release-and-consent-forms/actions.ts',
    action: 'sendSigningLinksAction',
  },
];

describe('irreversible actions ask for the passphrase again', () => {
  for (const { what, file, action } of GUARDED) {
    it(`asks before ${what}`, () => {
      const source = read(file);
      expect(source, `${file} no longer defines ${action}`).toContain(`export async function ${action}`);
      expect(source, `${action} is no longer behind reauthenticate()`).toMatch(
        /await reauthenticate\(/,
      );
    });
  }

  it('reads the passphrase from the form rather than from anywhere a link could set it', () => {
    // A value carried in the URL would be a passphrase in a browser history, a
    // referrer header and a server log, and a link somebody could be sent.
    const source = read(GUARDED[0].file);
    expect(source).toContain("formData.get('passphrase')");
  });

  it('refuses the erasure before it resolves anybody, so a wrong passphrase reads nothing', () => {
    const source = read(GUARDED[0].file);
    const guard = source.indexOf('await reauthenticate(');
    const resolve = source.indexOf('await resolvePerson(');
    expect(guard).toBeGreaterThan(-1);
    expect(resolve).toBeGreaterThan(guard);
  });
});
