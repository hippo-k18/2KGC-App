'use server';

import { redirect } from 'next/navigation';
import { signIn, signOut } from '@/lib/auth';

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const result = await signIn(String(formData.get('email') ?? ''));
  if (!result.ok) return { error: result.error };
  redirect('/sessions');
}

export async function logoutAction(): Promise<void> {
  await signOut();
  redirect('/login');
}
