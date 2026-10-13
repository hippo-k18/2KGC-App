import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { runCfpSchedule } from '@/lib/cfp';
import { recordError } from '@/lib/errors';

/**
 * `POST /api/cron/cfp` — the call for papers' clock (T249): E3 five days after
 * E2, and the Thursday reminder to the reviewer.
 *
 * ── Why a route and a droplet timer, not a Cloud Function ───────────────────
 *
 * Nothing in `functions/` is deployed (AGENTS.md: the IAM grant), so there is
 * no scheduled-function pattern to reuse. The dashboard already runs on the
 * droplet with Firestore and Resend configured, so a systemd timer posting
 * here hourly (`scripts/ops/kgc-cfp-cron.*`) is the smallest thing that works.
 * Every send is stamped on its submission, so a doubled or missed hour is
 * harmless: the next run sends what is due and nothing twice.
 *
 * ── Authorisation ───────────────────────────────────────────────────────────
 *
 * `Authorization: Bearer $CRON_SECRET`. No secret configured means the route
 * refuses everything, so a deployment that has not set it up cannot be poked
 * into mailing people.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? '';
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (secret.length < 16 || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 401 });
  }
  try {
    const report = await runCfpSchedule();
    return NextResponse.json(report);
  } catch (err) {
    recordError('cfp.cron', err);
    return NextResponse.json({ error: 'The run failed. See the dashboard error log.' }, { status: 500 });
  }
}
