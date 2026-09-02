/**
 * The consent register: who is expected to sign, who has, and against *what*.
 *
 * The rules module (`tests/rules`) proves that a signature cannot be forged or
 * edited. This proves the question asked afterwards — "is this person covered?"
 * — is answered correctly, and that is a different failure. A register that
 * says "signed" about somebody whose signature names superseded wording is
 * worse than one that says nothing, because it is the answer somebody acts on.
 *
 * ── Why this lives in `tests/programme` ─────────────────────────────────────
 *
 * Because that is the runner, not because consent is programme work.
 * `tests/programme` is the suite for pure logic that needs no emulator, and
 * `unsubscribe.test.ts` and `feature-search.test.ts` already sit here testing
 * `apps/organizer/src/lib` for the same reason. `npm test` and
 * `npm run test:programme` both include it; a new directory would be included
 * by neither until somebody edited the root `package.json`, and an unrun test
 * is worse than no test.
 *
 * `consents.ts` carries `server-only` and cannot be loaded by Vitest at all,
 * which is why `consents-core.ts` exists and why this file imports that.
 *
 * Run with: npm run test:programme
 */
import { describe, expect, it } from 'vitest';

import {
  audienceSources,
  buildRegister,
  totalsFor,
  unmatchedSignatures,
  type ConsentSubject,
  type SignatureRecord,
} from '../../apps/organizer/src/lib/consents-core';

const subject = (over: Partial<ConsentSubject> & { key: string }): ConsentSubject => ({
  name: 'Someone',
  kind: 'attendee',
  ...over,
});

const signature = (over: Partial<SignatureRecord> & { signatory: string }): SignatureRecord => ({
  formVersion: 1,
  signedName: 'Someone',
  channel: 'app',
  ...over,
});

describe('buildRegister — the three states', () => {
  it('reports a signature at the current version as signed', () => {
    const rows = buildRegister(
      [subject({ key: 'uid-a', name: 'Ada' })],
      [signature({ signatory: 'uid-a', formVersion: 3, signedName: 'Ada L' })],
      3,
    );
    expect(rows[0].status).toBe('signed');
    expect(rows[0].signedVersion).toBe(3);
    expect(rows[0].signedName).toBe('Ada L');
  });

  it('reports a signature at a superseded version as outdated, not signed', () => {
    // The case the third state exists for. Republishing at v3 does not void a
    // v2 signature — it makes it a signature to different words.
    const rows = buildRegister(
      [subject({ key: 'uid-a' })],
      [signature({ signatory: 'uid-a', formVersion: 2 })],
      3,
    );
    expect(rows[0].status).toBe('outdated');
    expect(rows[0].signedVersion).toBe(2);
  });

  it('reports somebody with no signature at all as unsigned, with no version', () => {
    const rows = buildRegister([subject({ key: 'uid-a' })], [], 1);
    expect(rows[0].status).toBe('unsigned');
    expect(rows[0].signedVersion).toBeUndefined();
  });

  it('treats a signature at a version ahead of the form as signed', () => {
    // Can happen if a form is rolled back. The signature is to wording at least
    // as new as the current text, so it must not read as outstanding.
    const rows = buildRegister(
      [subject({ key: 'uid-a' })],
      [signature({ signatory: 'uid-a', formVersion: 5 })],
      3,
    );
    expect(rows[0].status).toBe('signed');
  });
});

describe('buildRegister — matching a signature to a person', () => {
  it('matches on an alias, so an app signature credits the speaker row', () => {
    // A speaker who also holds a ticket signs in the app under their uid. The
    // speaker row is keyed spk_*, and without the alias they would show as
    // outstanding while their signature sat in the same subcollection.
    const rows = buildRegister(
      [subject({ key: 'spk_7', aliases: ['uid-a'], kind: 'speaker' })],
      [signature({ signatory: 'uid-a', formVersion: 1 })],
      1,
    );
    expect(rows[0].status).toBe('signed');
  });

  it('falls back to the email address when no key matches', () => {
    const rows = buildRegister(
      [subject({ key: 'spk_7', email: 'Ada@Example.com', kind: 'speaker' })],
      [signature({ signatory: 'someone-else', email: 'ada@example.com' })],
      1,
    );
    expect(rows[0].status).toBe('signed');
  });

  it('folds case and whitespace on the email fallback', () => {
    const rows = buildRegister(
      [subject({ key: 'k', email: '  ADA@example.com ' })],
      [signature({ signatory: 'other', email: 'ada@EXAMPLE.com' })],
      1,
    );
    expect(rows[0].status).toBe('signed');
  });

  it('prefers an explicit key match over a shared email address', () => {
    // ⚠️ The documented trap: two people behind one assistant's mailbox. The
    // key match must win, or each is credited with the other's signature.
    const rows = buildRegister(
      [subject({ key: 'uid-a', email: 'desk@example.com' })],
      [
        signature({ signatory: 'uid-a', formVersion: 1, signedName: 'Ada' }),
        signature({ signatory: 'uid-b', formVersion: 3, email: 'desk@example.com', signedName: 'Bo' }),
      ],
      3,
    );
    expect(rows[0].signedName).toBe('Ada');
    expect(rows[0].status).toBe('outdated');
  });

  it('does not match an empty key against a signature with an empty signatory', () => {
    const rows = buildRegister([subject({ key: '' })], [signature({ signatory: '' })], 1);
    expect(rows[0].status).toBe('unsigned');
  });

  it('does not credit a subject with no email from a signature with no email', () => {
    const rows = buildRegister(
      [subject({ key: 'uid-a' })],
      [signature({ signatory: 'uid-zzz' })],
      1,
    );
    expect(rows[0].status).toBe('unsigned');
  });
});

describe('buildRegister — picking between several signatures', () => {
  it('keeps the highest version, not the last one seen', () => {
    const rows = buildRegister(
      [subject({ key: 'uid-a' })],
      [
        signature({ signatory: 'uid-a', formVersion: 3 }),
        signature({ signatory: 'uid-a', formVersion: 1 }),
      ],
      3,
    );
    expect(rows[0].signedVersion).toBe(3);
    expect(rows[0].status).toBe('signed');
  });

  it('is order-independent when the same versions arrive reversed', () => {
    // "Newest" is by version rather than by signedAt, because clocks are not
    // comparable across a client write and a server write.
    const rows = buildRegister(
      [subject({ key: 'uid-a' })],
      [
        signature({ signatory: 'uid-a', formVersion: 1 }),
        signature({ signatory: 'uid-a', formVersion: 3 }),
      ],
      3,
    );
    expect(rows[0].signedVersion).toBe(3);
  });

  it('matches on the uid field as well as on signatory', () => {
    const rows = buildRegister(
      [subject({ key: 'uid-a' })],
      [signature({ signatory: 'spk_7', uid: 'uid-a', formVersion: 2 })],
      2,
    );
    expect(rows[0].status).toBe('signed');
  });
});

describe('unmatchedSignatures', () => {
  it('surfaces a signature belonging to nobody in the audience', () => {
    // A speaker dropped from the programme after signing. Silently discarding
    // this understates what was collected.
    const orphans = unmatchedSignatures(
      [subject({ key: 'uid-a', email: 'ada@example.com' })],
      [signature({ signatory: 'spk_gone', email: 'gone@example.com' })],
    );
    expect(orphans).toHaveLength(1);
    expect(orphans[0].signatory).toBe('spk_gone');
  });

  it('does not report a signature matched by alias as unmatched', () => {
    const orphans = unmatchedSignatures(
      [subject({ key: 'spk_7', aliases: ['uid-a'] })],
      [signature({ signatory: 'uid-a' })],
    );
    expect(orphans).toHaveLength(0);
  });

  it('does not report a signature matched only by email as unmatched', () => {
    const orphans = unmatchedSignatures(
      [subject({ key: 'spk_7', email: 'ada@example.com' })],
      [signature({ signatory: 'whoever', email: 'ADA@example.com' })],
    );
    expect(orphans).toHaveLength(0);
  });

  it('does not report a signature matched by its uid field as unmatched', () => {
    const orphans = unmatchedSignatures(
      [subject({ key: 'uid-a' })],
      [signature({ signatory: 'spk_7', uid: 'uid-a' })],
    );
    expect(orphans).toHaveLength(0);
  });

  it('returns nothing when there are no signatures', () => {
    expect(unmatchedSignatures([subject({ key: 'uid-a' })], [])).toEqual([]);
  });
});

describe('totalsFor', () => {
  it('counts each state once and sums to the expected total', () => {
    const rows = buildRegister(
      [
        subject({ key: 'a' }),
        subject({ key: 'b' }),
        subject({ key: 'c' }),
        subject({ key: 'd' }),
      ],
      [
        signature({ signatory: 'a', formVersion: 2 }),
        signature({ signatory: 'b', formVersion: 1 }),
        signature({ signatory: 'c', formVersion: 2 }),
      ],
      2,
    );
    const totals = totalsFor(rows);
    expect(totals).toEqual({ expected: 4, signed: 2, outdated: 1, unsigned: 1 });
    expect(totals.signed + totals.outdated + totals.unsigned).toBe(totals.expected);
  });

  it('reports zeroes rather than throwing on an empty register', () => {
    expect(totalsFor([])).toEqual({ expected: 0, signed: 0, outdated: 0, unsigned: 0 });
  });
});

describe('audienceSources', () => {
  it('maps attendee and speaker to their own source lists', () => {
    expect(audienceSources('attendee')).toEqual(['attendee']);
    expect(audienceSources('speaker')).toEqual(['speaker']);
  });

  it('returns no source for volunteer, because no volunteer roster exists', () => {
    // ⚠️ An empty register and a register of zero outstanding signatures look
    // identical and mean opposite things. This empty array is what lets the
    // screen tell them apart.
    expect(audienceSources('volunteer')).toEqual([]);
  });
});
