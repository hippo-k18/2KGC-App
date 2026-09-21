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
import { describe, expect, it } from 'vitest';

import {
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
