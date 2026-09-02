/**
 * The shared demo password, and the switch that turns it off.
 *
 * Small surface, and worth pinning anyway: every one of these behaviours is
 * load-bearing for something a person sees. An unset variable has to mean "use
 * the default" while an empty one means "off", because those are the two things
 * an operator will type and they must not collapse into each other. And the
 * six-character floor is Firebase's, verified against the Auth emulator rather
 * than assumed — `createUser({ password: '123' })` answers
 * `auth/invalid-password`, so a shorter value is a deployment that cannot
 * provision anybody.
 *
 * Lives in `tests/programme` because that is the runner for pure logic with no
 * emulator behind it — see the header of `unsubscribe.test.ts` for the longer
 * form of that argument.
 *
 * Run with: npm run test:programme
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DEMO_PASSWORD,
  DemoPasswordTooShort,
  FIREBASE_MIN_PASSWORD_LENGTH,
  demoPassword,
  demoPasswordEnabled,
} from '../../scripts/src/lib/demo-password';

const env = (v?: string) => ({ ...(v === undefined ? {} : { DEMO_ATTENDEE_PASSWORD: v }) }) as NodeJS.ProcessEnv;

describe('demoPassword', () => {
  it('falls back to the default when the variable is unset', () => {
    expect(demoPassword(env())).toBe(DEFAULT_DEMO_PASSWORD);
  });

  it('has a default that clears Firebase’s minimum', () => {
    // The whole reason the default is not "123", which is what was asked for.
    expect(DEFAULT_DEMO_PASSWORD.length).toBeGreaterThanOrEqual(FIREBASE_MIN_PASSWORD_LENGTH);
  });

  it('returns null for an explicitly empty value, which is the off switch', () => {
    expect(demoPassword(env(''))).toBeNull();
  });

  it('treats whitespace-only as empty rather than as a password', () => {
    expect(demoPassword(env('   '))).toBeNull();
  });

  it('distinguishes unset from empty — they are opposite instructions', () => {
    expect(demoPassword(env())).not.toBeNull();
    expect(demoPassword(env(''))).toBeNull();
  });

  it('uses an explicit value over the default', () => {
    expect(demoPassword(env('correcthorse'))).toBe('correcthorse');
  });

  it('trims a value that arrived with stray whitespace', () => {
    // A .env line copied out of a chat message is the realistic source.
    expect(demoPassword(env('  hunter2go  '))).toBe('hunter2go');
  });

  it('throws on a value Firebase would reject, naming the fix', () => {
    expect(() => demoPassword(env('123'))).toThrow(DemoPasswordTooShort);
    expect(() => demoPassword(env('123'))).toThrow(/at least 6/);
  });

  it('throws on every length below the floor and accepts the floor itself', () => {
    for (const short of ['1', '12', '123', '1234', '12345']) {
      expect(() => demoPassword(env(short))).toThrow(DemoPasswordTooShort);
    }
    expect(demoPassword(env('123456'))).toBe('123456');
  });
});

describe('demoPasswordEnabled', () => {
  it('is true when a usable password is configured', () => {
    expect(demoPasswordEnabled(env())).toBe(true);
    expect(demoPasswordEnabled(env('correcthorse'))).toBe(true);
  });

  it('is false when switched off', () => {
    expect(demoPasswordEnabled(env(''))).toBe(false);
  });

  it('is false rather than throwing on a misconfigured value', () => {
    // The throw belongs on the path that would actually set the password, where
    // the error can name the fix. A predicate that throws would take down the
    // confirmation page over a variable it only wanted to read.
    expect(demoPasswordEnabled(env('123'))).toBe(false);
  });
});
