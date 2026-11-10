import { describe, expect, it } from 'vitest';
import { DRAFT_MAX_AGE_MS, RELOAD_LOOP_MS, isStaleActionError, keepsField, readDraft, reloadedRecently, staleNextStep } from './stale-action-core';

describe('stale action guard (T379)', () => {
  it('recognises the stale-build error and nothing else', () => {
    expect(isStaleActionError(new Error('Server action not found.'))).toBe(true);
    // What Next 15.5's router throws (T379 harness, build A page posting to build B).
    const unrecognized = Object.assign(new Error('Server Action "408520d2edd6e55a522754f5a7cffe7ba2207a0150" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action'), { name: 'UnrecognizedActionError' });
    expect(isStaleActionError(unrecognized)).toBe(true);
    expect(isStaleActionError(new Error('Server Action "abc" was not found on the server.'))).toBe(true);
    expect(isStaleActionError(new Error('Failed to find Server Action "abc". This request might be from an older or newer deployment.'))).toBe(true);
    expect(isStaleActionError(new Error('An unexpected response was received from the server.'))).toBe(false);
    expect(isStaleActionError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isStaleActionError(undefined)).toBe(false);
  });

  it('reads a fresh draft, drops an old or broken one', () => {
    const now = 1_000_000_000;
    const raw = JSON.stringify({ at: now - 1000, values: { bio: ['Hello'], bad: [1] }, reloadedAt: now - 500 });
    expect(readDraft(raw, now)).toEqual({ at: now - 1000, values: { bio: ['Hello'] }, reloadedAt: now - 500 });
    expect(readDraft(JSON.stringify({ at: now - DRAFT_MAX_AGE_MS - 1, values: {} }), now)).toBeNull();
    expect(readDraft('{not json', now)).toBeNull();
    expect(readDraft(null, now)).toBeNull();
  });

  it('reloads once, not in a loop', () => {
    const now = 5_000_000;
    expect(reloadedRecently(null, now)).toBe(false);
    expect(reloadedRecently({ at: now, values: {}, reloadedAt: now - 10_000 }, now)).toBe(true);
    expect(reloadedRecently({ at: now, values: {}, reloadedAt: now - 10 * 60_000 }, now)).toBe(false);
  });

  it('never keeps the token, action ids, files or buttons', () => {
    expect(keepsField({ name: 'bio', type: 'textarea' })).toBe(true);
    expect(keepsField({ name: 'photoURL', type: 'url' })).toBe(true);
    expect(keepsField({ name: 'token', type: 'hidden' })).toBe(false);
    expect(keepsField({ name: '$ACTION_ID_abc', type: 'hidden' })).toBe(false);
    expect(keepsField({ name: 'photoFile', type: 'file' })).toBe(false);
    expect(keepsField({ name: 'intent', type: 'submit' })).toBe(false);
    expect(keepsField({ name: 'kept', type: 'hidden', keep: true })).toBe(true);
  });

  it('reloads by itself once, then asks for a reload instead of Send (T388)', () => {
    const now = 9_000_000;
    // First stale press: nothing saved yet, so reload.
    expect(staleNextStep(null, now)).toBe('reload');
    // Second deploy a minute after that reload: ask, do not loop.
    expect(staleNextStep({ at: now, values: {}, reloadedAt: now - 60_000 }, now)).toBe('ask-reload');
    // Long after the last reload, a new deploy reloads by itself again.
    expect(staleNextStep({ at: now, values: {}, reloadedAt: now - RELOAD_LOOP_MS - 1 }, now)).toBe('reload');
  });
});
