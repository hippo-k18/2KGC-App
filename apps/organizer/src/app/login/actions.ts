'use server';

import { redirect } from 'next/navigation';
import { requestSignInCode, signInWithCode, signOut } from '@/lib/auth';

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

  const result = await signInWithCode(prev.email ?? '', String(formData.get('code') ?? ''));
  if (!result.ok) return { ...prev, notice: undefined, error: result.error };
  // Where their roles start: an owner on Basics, a check-in account on Check-in.
  redirect(result.home);
}

export async function logoutAction(): Promise<void> {
  await signOut();
  redirect('/login');
}
