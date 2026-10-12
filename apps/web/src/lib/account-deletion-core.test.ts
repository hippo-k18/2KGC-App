import { describe, expect, it } from 'vitest';
import { DELETED_USER_ID, DELETED_USER_NAME, isDeletedUser } from '@kgc/shared';

import { deleteAccountData } from './account-deletion-core';

/**
 * The guards that run before anything is read. The deletion itself is pinned
 * on the emulator in `tests/account-deletion`.
 */
describe('deleteAccountData guards', () => {
  // Any touch of these fails the test: the guard must throw before using them.
  const untouchable = new Proxy({}, { get: () => { throw new Error('touched the store'); } }) as never;

  it.each([
    ['an empty id', ''],
    ['the deleted-user marker itself', DELETED_USER_ID],
    ['a path instead of an id', 'abc/def'],
  ])('refuses %s', async (_label, uid) => {
    await expect(deleteAccountData(untouchable, untouchable, uid)).rejects.toThrow('Not a deletable account id.');
  });
});

describe('the deleted-user marker', () => {
  it('is recognised, and only it is', () => {
    expect(isDeletedUser(DELETED_USER_ID)).toBe(true);
    expect(isDeletedUser('a1b2c3')).toBe(false);
    expect(isDeletedUser(undefined)).toBe(false);
    expect(DELETED_USER_NAME).toBe('Deleted user');
  });

  it('cannot be a real uid: derived uids are hex and Auth ones are alphanumeric', () => {
    expect(/^[a-zA-Z0-9]+$/.test(DELETED_USER_ID)).toBe(false);
  });
});
