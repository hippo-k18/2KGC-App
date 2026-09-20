'use server';

import { redirect } from 'next/navigation';
import { signIn, signOut } from '@/lib/auth';

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const result = await signIn(
    String(formData.get('email') ?? ''),
    String(formData.get('passphrase') ?? ''),
  );
  if (!result.ok) return { error: result.error };
  // Where their roles start: an owner on Basics, a check-in account on Check-in.
  redirect(result.home);
}

export async function logoutAction(): Promise<void> {
  await signOut();
  redirect('/login');
}
