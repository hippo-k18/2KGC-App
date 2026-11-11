import { describe, expect, it } from 'vitest';

import {
  NO_POINTER_MEMORY,
  POINTER_ATTEMPTS,
  nextPointerMemory,
  pointerKey,
  pointerRetryDue,
  pointerWanted,
  pointerWriteDue,
} from './registration-pointer-core';

const KEY = pointerKey('uid-1', 'reg_abc');

describe('pointerWanted', () => {
  const base = { uid: 'uid-1', address: 'ada@example.test', settled: true, pointer: null };

  it('is true for a fresh account that has never stored one', () => {
    expect(pointerWanted(base)).toBe(true);
  });

  it('is false once the account carries one, so nobody pays for a second lookup', () => {
    expect(pointerWanted({ ...base, pointer: 'reg_abc' })).toBe(false);
  });

  it('waits for the profile read rather than guessing it is absent', () => {
    expect(pointerWanted({ ...base, settled: false })).toBe(false);
  });

  it('is false with no account and with no address to look one up by', () => {
    expect(pointerWanted({ ...base, uid: undefined })).toBe(false);
    expect(pointerWanted({ ...base, address: null })).toBe(false);
  });

  it('treats an empty stored pointer as no pointer', () => {
    expect(pointerWanted({ ...base, pointer: '' })).toBe(true);
  });
});

describe('what is remembered between attempts', () => {
  /*
   * The bug, stated as a test.
   *
   * The old hook marked the pair as attempted *before* the write went out, so
   * one failure meant no second try for the life of that mount — and the
   * attendee's video stayed locked with the screen insisting their ticket
   * covered it. A failure must leave the write still owed.
   */
  it('still owes the write after one failure', () => {
    const after = nextPointerMemory(NO_POINTER_MEMORY, KEY, false);
    expect(pointerWriteDue(after, KEY)).toBe(true);
    expect(pointerRetryDue(after)).toBe(true);
  });

  it('stops owing it once it lands', () => {
    const after = nextPointerMemory(NO_POINTER_MEMORY, KEY, true);
    expect(pointerWriteDue(after, KEY)).toBe(false);
  });

  it('gives up rather than hammering the rules for an account with no ticket', () => {
    let memory = NO_POINTER_MEMORY;
    for (let i = 0; i < POINTER_ATTEMPTS; i += 1) {
      memory = nextPointerMemory(memory, KEY, false);
    }
    expect(memory.attempt).toBe(POINTER_ATTEMPTS);
    expect(pointerRetryDue(memory)).toBe(false);
  });

  it('counts a fresh account back to zero after a success', () => {
    const failed = nextPointerMemory(NO_POINTER_MEMORY, KEY, false);
    expect(nextPointerMemory(failed, KEY, true)).toEqual({ written: KEY, attempt: 0 });
  });

  it('owes a write again when the registration it found is a different one', () => {
    const after = nextPointerMemory(NO_POINTER_MEMORY, KEY, true);
    expect(pointerWriteDue(after, pointerKey('uid-1', 'reg_other'))).toBe(true);
  });

  it('owes nothing when no registration was found at all', () => {
    expect(pointerWriteDue(NO_POINTER_MEMORY, null)).toBe(false);
  });
});
