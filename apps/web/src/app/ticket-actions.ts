'use server';

import { revalidatePath } from 'next/cache';
import { clearTicketPass, setTicketPass } from '@/lib/ticket-pass';

/**
 * The two buttons that decide whether this browser is carrying a ticket.
 *
 * At the app root rather than under `/order`, because both ends need them: the
 * confirmation page offers the ticket to the device, and every session page
 * offers to forget it. A server action is the only place a cookie can be
 * written in the App Router — a Server Component may read `cookies()` and may
 * not set one — which is also the right shape here, because taking a ticket
 * onto a device is a deliberate act and not a side effect of loading a page.
 *
 * ⚠️ Neither of these takes a registration id, an address or a ticket type.
 * The only input is the order token itself, which is verified by
 * `setTicketPass` before it is stored. There is no field here that could name
 * somebody else.
 */

export async function useTicketOnThisDeviceAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  await setTicketPass(token);
  /*
   * The confirmation page is `force-dynamic`, but the agenda pages that read
   * the cookie are cached per path in the router cache the browser keeps. The
   * layout revalidation is what makes the next session page they open render
   * with the ticket rather than without it.
   */
  revalidatePath('/', 'layout');
}

export async function forgetTicketAction(): Promise<void> {
  await clearTicketPass();
  revalidatePath('/', 'layout');
}
