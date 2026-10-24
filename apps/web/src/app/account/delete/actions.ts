'use server';

import { deleteAccountData, uidForDeletion } from '@/lib/account-deletion-core';
import { uidForEmail } from '@/lib/app-account-core';
import { recordError } from '@/lib/errors';
import { adminAuth, db } from '@/lib/firestore';
import { readTicketPass } from '@/lib/ticket-pass';

export type DeleteState = { done?: boolean; error?: string };

/**
 * Delete the app account of the person signed in on this site with their
 * ticket. The address comes from the signed cookie, never from the form, so
 * the form cannot name somebody else.
 */
export async function deleteSignedInAccountAction(_prev: DeleteState, form: FormData): Promise<DeleteState> {
  if (String(form.get('confirm') ?? '').trim().toUpperCase() !== 'DELETE') {
    return { error: 'Type DELETE to confirm.' };
  }
  const pass = await readTicketPass();
  if (!pass) return { error: 'You are no longer signed in. Use the email code instead.' };

  try {
    const uid = await uidForDeletion(adminAuth(), pass.email, uidForEmail(pass.email));
    await deleteAccountData(adminAuth(), db(), uid);
    return { done: true };
  } catch (err) {
    await recordError('account.delete', err, { path: 'users', id: uidForEmail(pass.email) });
    return { error: 'Your account could not be deleted. Try again in a minute.' };
  }
}
