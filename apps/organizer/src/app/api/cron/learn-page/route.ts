import { NextResponse, type NextRequest } from 'next/server';
import { cronAuthorized } from '@/lib/cron-auth';
import { recordError } from '@/lib/errors';
import { runLearnPageCronStep } from '@/lib/learn-page-ops';

/**
 * `POST /api/cron/learn-page`: the KGC | Learn page's scheduled publish (T316).
 *
 * Posted to every minute by the droplet's `kgc-learn-cron.timer`, the same
 * arrangement as `/api/cron/cfp` and for the same reason (nothing in
 * `functions/` is deployed). The run is one Firestore read when nothing is
 * due, and a doubled or missed minute is harmless: the publish clears the
 * schedule in the transaction that does it, so the next run finds nothing.
 * www then picks the page up on its 30 second revalidate.
 *
 * `?now=<ISO>` moves the clock for a local run. Ignored in production.
 */
export async function POST(request: NextRequest) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: 'Not allowed.' }, { status: 401 });
  const fake = request.nextUrl.searchParams.get('now');
  const nowMs = process.env.NODE_ENV !== 'production' && fake ? Date.parse(fake) : Date.now();
  try {
    const result = await runLearnPageCronStep(Number.isFinite(nowMs) ? nowMs : Date.now());
    return NextResponse.json(result);
  } catch (err) {
    recordError('learnPage.cron', err);
    return NextResponse.json({ error: 'The run failed. See the dashboard error log.' }, { status: 500 });
  }
}
