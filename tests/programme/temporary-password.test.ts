/**
 * The six-digit temporary password a purchase issues.
 *
 * Two properties carry the whole design and both are cheap to get wrong:
 * the value must be **six digits including leading zeros**, because Firebase
 * rejects anything shorter and a five-character password is a deployment that
 * cannot provision anybody; and it must be **different every time**, because
 * the version this replaced was one shared string and that was the objection.
 *
 * Lives in `tests/programme` because that is the runner for pure logic with no
 * emulator behind it — see the header of `unsubscribe.test.ts` for the longer
 * form of that argument.
 *
 * Run with: npm run test:programme
 */
import { describe, expect, it } from 'vitest';

import {
  TEMPORARY_PASSWORD_LENGTH,
  generateTemporaryPassword,
  temporaryPasswordsEnabled,
} from '../../scripts/src/lib/temporary-password';

const env = (v?: string) =>
  ({ ...(v === undefined ? {} : { ISSUE_TEMPORARY_PASSWORDS: v }) }) as NodeJS.ProcessEnv;

describe('generateTemporaryPassword', () => {
  it('is exactly six digits', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateTemporaryPassword()).toMatch(/^\d{6}$/);
    }
  });

  it('clears Firebase’s six-character floor on every draw', () => {
    // Not a restatement of the test above: the floor is the reason the length
    // is what it is, and a future edit that made this five digits would pass a
    // "looks like digits" check and fail every real provision.
    for (let i = 0; i < 200; i += 1) {
      expect(generateTemporaryPassword().length).toBeGreaterThanOrEqual(
        TEMPORARY_PASSWORD_LENGTH,
      );
    }
  });

  it('keeps leading zeros rather than shortening the value', () => {
    // The failure this guards: generating a number and stringifying it, so
    // 000123 becomes "123" and Firebase rejects it with auth/invalid-password.
    // A tenth of the keyspace starts with a zero, so 4000 draws makes an
    // absence conclusive rather than unlucky.
    const draws = Array.from({ length: 4000 }, generateTemporaryPassword);
    expect(draws.every((d) => d.length === 6)).toBe(true);
    expect(draws.some((d) => d.startsWith('0'))).toBe(true);
  });

  it('does not repeat itself, which is the whole point of the change', () => {
    // A shared password would collapse this to a single value. Birthday
    // collisions in 1000 draws from a million-wide space are expected (~40%
    // chance of at least one), so this asserts variety rather than uniqueness.
    const draws = new Set(Array.from({ length: 1000 }, generateTemporaryPassword));
    expect(draws.size).toBeGreaterThan(900);
  });

  it('spreads across the range rather than clustering', () => {
    // A cheap smoke test for a broken bound — sampling 0..999999 should put
    // values in both halves and across first digits.
    const draws = Array.from({ length: 1000 }, generateTemporaryPassword);
    expect(draws.some((d) => Number(d) < 500000)).toBe(true);
    expect(draws.some((d) => Number(d) >= 500000)).toBe(true);
    expect(new Set(draws.map((d) => d[0])).size).toBeGreaterThan(5);
  });
});

describe('temporaryPasswordsEnabled', () => {
  it('is on when the variable is unset', () => {
    expect(temporaryPasswordsEnabled(env())).toBe(true);
  });

  it('is off only for an explicit 0 or false', () => {
    expect(temporaryPasswordsEnabled(env('0'))).toBe(false);
    expect(temporaryPasswordsEnabled(env('false'))).toBe(false);
    expect(temporaryPasswordsEnabled(env('FALSE'))).toBe(false);
    expect(temporaryPasswordsEnabled(env(' 0 '))).toBe(false);
  });

  it('stays on for anything else, including a typo', () => {
    // The off position means buyers cannot sign in without the OTP callables,
    // and those are not deployed. Failing on towards a working sign-in is the
    // safe direction for a switch with that consequence.
    expect(temporaryPasswordsEnabled(env('1'))).toBe(true);
    expect(temporaryPasswordsEnabled(env('true'))).toBe(true);
    expect(temporaryPasswordsEnabled(env(''))).toBe(true);
    expect(temporaryPasswordsEnabled(env('no'))).toBe(true);
  });
});
