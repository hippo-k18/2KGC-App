'use server';

import { redirect } from 'next/navigation';
import { signIn } from '@/lib/auth';
import { setPassphraseWithLink } from '@/lib/team';

export interface SetPassphraseState {
  error?: string;
}

/**
 * The one server action with no `requireOrganizer()`: the caller has no session
 * and the link in `token` is what authorises the write. `setPassphraseWithLink`
 * checks its signature, its expiry and that it has not been used.
 */
export async function setPassphraseAction(
  _prev: SetPassphraseState,
  formData: FormData,
): Promise<SetPassphraseState> {
  const passphrase = String(formData.get('passphrase') ?? '');
  if (passphrase !== String(formData.get('again') ?? '')) {
    return { error: 'The two passphrases do not match.' };
  }

  const res = await setPassphraseWithLink(String(formData.get('token') ?? ''), passphrase);
  if (!res.ok) return { error: res.error };

  // Straight in, through the same door as every other sign-in, so they land on
  // the screen their roles start at.
  const signedIn = await signIn(String(formData.get('email') ?? ''), passphrase);
  redirect(signedIn.ok ? signedIn.home : '/login');
}
