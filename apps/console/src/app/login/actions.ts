'use server';

import { redirect } from 'next/navigation';
import { signIn, signOut } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const result = await signIn(String(formData.get('email') ?? ''));
  if (!result.ok) return { error: result.error };
  redirect(ROUTES.basics);
}

export async function logoutAction(): Promise<void> {
  await signOut();
  redirect('/login');
}
