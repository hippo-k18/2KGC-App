'use server';

import { redirect } from 'next/navigation';
import { requestSignInCode, signInWithCode, signOut, signOutEverywhere } from '@/lib/auth';

export interface LoginState {
  step: 'email' | 'code';
  email?: string;
  error?: string;
  /** Shown above the code box after "Send a new code". */
  notice?: string;
}

/** One form, two steps: the address, then the code mailed to it. */
export async function loginAction(prev: LoginState, formData: FormData): Promise<LoginState> {
  const intent = formData.get('intent');
  if (intent === 'restart') return { step: 'email', email: prev.email };

  if (prev.step === 'email' || intent === 'resend') {
    const res = await requestSignInCode(String(formData.get('email') ?? prev.email ?? ''));
    if (!res.ok) return { step: 'email', email: String(formData.get('email') ?? prev.email ?? ''), error: res.error };
    return { step: 'code', email: res.email, notice: intent === 'resend' ? 'A new code is on its way.' : undefined };
  }

  const keep = formData.get('keep') === 'on';
  const result = await signInWithCode(prev.email ?? '', String(formData.get('code') ?? ''), keep);
  if (!result.ok) return { ...prev, notice: undefined, error: result.error };
  // Where their roles start: an owner on Basics, a check-in account on Check-in.
  redirect(result.home);
}

export async function logoutAction(): Promise<void> {
  await signOut();
  redirect('/login');
}

/** Ends every session the signed-in person holds, on this device and any other. */
export async function logoutEverywhereAction(): Promise<void> {
  const ended = await signOutEverywhere();
  // If the epoch could not be changed, only this browser is signed out, and the page says so.
  redirect(ended ? '/login?signedOut=all' : '/login?signedOut=here');
}
