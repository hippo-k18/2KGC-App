import { NextResponse, type NextRequest } from 'next/server';
import { drainHubspotQueue } from '@kgc/scripts/src/lib/hubspot-sync';
import { cronAuthorized } from '@/lib/cron-auth';
import { recordError } from '@/lib/errors';
import { db } from '@/lib/firestore';

/**
 * `POST /api/cron/hubspot`: the HubSpot sync's retry timer (T333).
 *
 * Posted to every 10 minutes by the droplet's `kgc-hubspot-cron.timer`, the
 * same arrangement as `/api/cron/cfp`. Every trigger already starts a send
 * itself, so this only picks up what is left: contacts HubSpot refused for a
 * moment (rate limit, outage) and are due again, and a send cut short by a
 * restart. When the sync is off, or nothing is due, it is two Firestore reads.
 * A second drain cannot overlap a running one: the lease in
 * `integrations/hubspotLock` refuses it.
 */
export async function POST(request: NextRequest) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: 'Not allowed.' }, { status: 401 });
  try {
    const run = await drainHubspotQueue(db(), { trigger: 'cron' });
    return NextResponse.json(
      run
        ? { ran: true, sent: run.sent, created: run.created, updated: run.updated, skipped: run.skipped, failed: run.failed, stopped: run.stopped ?? null }
        : { ran: false },
    );
  } catch (err) {
    recordError('hubspot.cron', err);
    return NextResponse.json({ error: 'The run failed. See the dashboard error log.' }, { status: 500 });
  }
}
