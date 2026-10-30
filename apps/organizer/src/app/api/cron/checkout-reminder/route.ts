import { NextResponse, type NextRequest } from 'next/server';
import { runCheckoutReminders } from '@/lib/checkout-reminder';
import { cronAuthorized } from '@/lib/cron-auth';
import { recordError } from '@/lib/errors';

/**
 * `POST /api/cron/checkout-reminder`: the reminder to people who left the
 * payment page (T363).
 *
 * Posted to every 15 minutes by the droplet's `kgc-reminder-cron.timer`, the
 * same arrangement and secret as `/api/cron/hubspot`. While the reminder is
 * off this is one Firestore read. Each person is claimed in a transaction
 * before the send, so two overlapping runs cannot mail anybody twice.
 */
export async function POST(request: NextRequest) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: 'Not allowed.' }, { status: 401 });
  try {
    return NextResponse.json(await runCheckoutReminders());
  } catch (err) {
    recordError('checkout-reminder.cron', err);
    return NextResponse.json({ error: 'The run failed. See the dashboard error log.' }, { status: 500 });
  }
}
