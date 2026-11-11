'use server';

import { sendConfirmCode } from '@/lib/auth';

/** Mail the signed-in organizer a code to confirm a refund, an erasure or a mass send. */
export async function sendConfirmCodeAction() {
  return sendConfirmCode();
}
