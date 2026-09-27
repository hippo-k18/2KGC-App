'use server';

import { revalidatePath } from 'next/cache';
import { clearTicketPass, requestTicketCode, verifyTicketCode } from '@/lib/ticket-pass';

/**
 * Signing a ticket holder in and out on a session page. See `lib/ticket-pass.ts`.
 *
 * A server action is the only place a cookie can be written in the App Router,
 * and the layout revalidation is what makes the next session page they open
 * render with the ticket rather than from the router cache without it.
 */

export interface TicketSignInState {
  step: 'email' | 'code' | 'done';
  email: string;
  error?: string;
}

export async function ticketSignInAction(prev: TicketSignInState, form: FormData): Promise<TicketSignInState> {
  const intent = String(form.get('intent') ?? '');

  if (intent === 'restart') return { step: 'email', email: prev.email };

  if (prev.step === 'email' || intent === 'resend') {
    const email = intent === 'resend' ? prev.email : String(form.get('email') ?? '');
    const sent = await requestTicketCode(email);
    return sent.ok ? { step: 'code', email: sent.email } : { step: 'email', email, error: sent.error };
  }

  const result = await verifyTicketCode(prev.email, String(form.get('code') ?? ''));
  if (!result.ok) return { ...prev, error: result.error };
  revalidatePath('/', 'layout');
  return { step: 'done', email: prev.email };
}

export async function ticketSignOutAction(): Promise<void> {
  await clearTicketPass();
  revalidatePath('/', 'layout');
}
