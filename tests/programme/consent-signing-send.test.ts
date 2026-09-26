/**
 * Sending the signing links: who gets one, and who must not get a second.
 *
 * ── The failure this suite exists for ───────────────────────────────────────
 *
 * Publishing a consent form used to mail every outstanding person from inside
 * the save action: no preview, no count, no confirmation and no record of how
 * far it got. On a thousand-attendee event that is fifty rounds of live API
 * calls inside one request, a timeout at 26 seconds, a generic error, and an
 * organizer pressing Save again — after which the first three hundred people
 * hold two links, each of which signs a legal release in their name.
 *
 * Publishing and sending are two steps now, and the send is resumable. The part
 * that makes it resumable is here, because it is the part that can be wrong
 * quietly: `signingSendSplit` decides who a press writes to, given who the
 * `emailLog` says has already been written to, and both the screen's count and
 * the sender's loop are built from the same call. Two code paths answering "how
 * many?" is how a typed confirmation stops meaning anything.
 *
 * `lib/consents.ts` carries `server-only` and cannot be loaded by Vitest at
 * all, which is why the decision lives in `consents-core.ts` beside the rest of
 * the register arithmetic.
 *
 * Run with: npm test
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  SEND_LOCK_STALE_MS,
  sendLockIsFree,
  signingCampaignId,
  signingSendSplit,
  type RegisterRow,
} from '../../apps/organizer/src/lib/consents-core';

const row = (over: Partial<RegisterRow> & { key: string }): RegisterRow => ({
  name: over.name ?? over.key,
  kind: 'attendee',
  status: 'unsigned',
  ...over,
});

const AUDIENCE: RegisterRow[] = [
  row({ key: 'u1', email: 'ada@example.com' }),
  row({ key: 'u2', email: 'Bilal.Haddad@Example.com' }),
  row({ key: 'u3', email: 'cai@example.com', status: 'outdated', signedVersion: 1 }),
  row({ key: 'u4', email: 'dee@example.com', status: 'signed', signedVersion: 2 }),
  row({ key: 'u5' }), // on the programme, no address on file
];

describe('who a send writes to', () => {
  it('leaves out anybody who has signed this version', () => {
    const { todo } = signingSendSplit(AUDIENCE, new Set());
    expect(todo.map((r) => r.key)).not.toContain('u4');
  });

  it('includes somebody who signed an earlier wording', () => {
    // Their agreement still stands for what it said and does not cover the new
    // text, so they are asked again and the mail says why.
    const { todo } = signingSendSplit(AUDIENCE, new Set());
    expect(todo.map((r) => r.key)).toContain('u3');
  });

  it('counts the unreachable separately rather than dropping them', () => {
    const split = signingSendSplit(AUDIENCE, new Set());
    expect(split.noAddress).toBe(1);
    expect(split.outstanding).toBe(4);
    expect(split.todo).toHaveLength(3);
  });
});

describe('a second press does not write to anybody twice', () => {
  /**
   * The set comes from `emailLog`, one row per recipient, written as each one
   * goes out. A press after a timeout therefore resumes rather than restarts.
   */
  it('skips everybody the last press reached', () => {
    const mailed = new Set(['ada@example.com', 'cai@example.com']);
    const split = signingSendSplit(AUDIENCE, mailed);
    expect(split.todo.map((r) => r.key)).toEqual(['u2']);
    expect(split.alreadySent).toBe(2);
  });

  it('matches an address the log stored as it was typed', () => {
    // `emailLog.to` holds whatever the caller passed, and the register row may
    // hold a different spelling of the same address. An unfolded comparison
    // here would send Bilal a second copy on every press for ever.
    const mailed = new Set(['bilal.haddad@example.com']);
    const split = signingSendSplit(AUDIENCE, mailed);
    expect(split.todo.map((r) => r.key)).not.toContain('u2');
    expect(split.alreadySent).toBe(1);
  });

  it('has nothing left to do once everybody reachable has been written to', () => {
    const all = new Set(['ada@example.com', 'bilal.haddad@example.com', 'cai@example.com']);
    const split = signingSendSplit(AUDIENCE, all);
    expect(split.todo).toHaveLength(0);
    expect(split.alreadySent).toBe(3);
    // The person with no address is still outstanding and is still not a send.
    expect(split.noAddress).toBe(1);
  });

  it('adds up: everybody outstanding is in exactly one of the three counts', () => {
    const mailed = new Set(['ada@example.com']);
    const split = signingSendSplit(AUDIENCE, mailed);
    expect(split.todo.length + split.alreadySent + split.noAddress).toBe(split.outstanding);
  });
});

describe('the run is named after the wording, not just the form', () => {
  it('starts a new run when the wording changes', () => {
    // Rewording makes every signature outstanding again and those people do
    // have to be asked again — so version 3 must not be told that everybody
    // already had version 2's link.
    expect(signingCampaignId('form_1', 2)).not.toBe(signingCampaignId('form_1', 3));
  });

  it('is the same run for the same form and version, which is what makes a retry safe', () => {
    expect(signingCampaignId('form_1', 2)).toBe(signingCampaignId('form_1', 2));
  });

  it('does not collide between two forms', () => {
    expect(signingCampaignId('form_1', 2)).not.toBe(signingCampaignId('form_2', 2));
  });
});

/**
 * ⚠️ The gap the log leaves, and what covers it.
 *
 * `emailLog` makes the NEXT press safe. It cannot make a simultaneous one safe:
 * two organizers pressing Send in the same second both read the log before
 * either has written to it, both see nobody, and both mail the same people a
 * link that signs a legal release in their name. The docblocks used to claim
 * the re-read covered this and it never did.
 *
 * So a send holds its campaign while it runs. Taking the lock is a transaction
 * on a document named after the campaign, so Firestore picks the winner; the
 * loser sends nothing and the screen says somebody else is sending. The
 * decision inside that transaction is the part worth testing on its own, and it
 * is here.
 */
describe('two organizers pressing Send at the same moment', () => {
  it('lets the first press take a campaign nobody holds', () => {
    expect(sendLockIsFree(undefined, 1_000_000)).toBe(true);
  });

  it('refuses the second press while the first is still running', () => {
    const took = 1_000_000;
    // Both presses read `emailLog` in this window and both see an empty set.
    // The lock is the only thing standing between that and two mails.
    expect(sendLockIsFree(took, took + 1)).toBe(false);
    expect(sendLockIsFree(took, took + SEND_LOCK_STALE_MS - 1)).toBe(false);
  });

  /**
   * A send is killed at 26 seconds, so a lock older than the ceiling belongs to
   * a process that is not running. Holding it for ever would mean one crash
   * takes a campaign down permanently — nobody could ever be sent their link.
   */
  it('lets a later press take over a lock the crash of an earlier one left behind', () => {
    const took = 1_000_000;
    expect(sendLockIsFree(took, took + SEND_LOCK_STALE_MS)).toBe(true);
    expect(sendLockIsFree(took, took + 60_000)).toBe(true);
  });

  it('is a ceiling above the budget the send stops itself on', () => {
    // 18s of sending inside a 26s request: a lock that went stale sooner would
    // hand the campaign to a second press while the first was still mailing.
    expect(SEND_LOCK_STALE_MS).toBeGreaterThan(18_000);
  });
});

/**
 * Where the lock sits, asserted rather than trusted.
 *
 * `lib/consents.ts` carries `server-only` and cannot be loaded here, so its
 * source is what is read — the same approach `tests/parity/step-up-guard.test.ts`
 * takes to the same kind of problem.
 *
 * The ordering is the whole point. A set of addresses gathered before the lock
 * is taken is the stale read the lock exists to prevent, so `alreadyMailed` has
 * to be called inside it and not on the way in.
 */
describe('the send holds the campaign while it reads and writes', () => {
  const body = () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../apps/organizer/src/lib/consents.ts', import.meta.url)),
      'utf8',
    );
    const start = source.indexOf('export async function sendSigningLinks');
    const end = source.indexOf('\nexport ', start + 1);
    return source.slice(start, end === -1 ? source.length : end);
  };

  it('takes the lock before it reads who has already been mailed', () => {
    const took = body().indexOf('withSendLock(');
    const read = body().indexOf('alreadyMailed(');
    expect(took, 'sendSigningLinks no longer takes a lock').toBeGreaterThan(-1);
    expect(read, 'the log is read outside the lock, which is the race itself').toBeGreaterThan(took);
  });

  it('sends the mail inside the lock too', () => {
    expect(body().indexOf('sendConsentRequest(')).toBeGreaterThan(body().indexOf('withSendLock('));
  });

  it('releases it however the send ends', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../apps/organizer/src/lib/consents.ts', import.meta.url)),
      'utf8',
    );
    const start = source.indexOf('async function withSendLock');
    const guard = source.slice(start, source.indexOf('\nexport ', start + 1));
    expect(guard).toMatch(/finally \{/);
    expect(guard).toContain('runTransaction');
  });
});
