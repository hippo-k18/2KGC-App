import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { runCfpSchedule } from '@/lib/cfp';
import { COLLECTIONS } from '@kgc/shared';
import { CRON_STATUS_DOC } from '@/lib/email-schedule';
import { recordError } from '@/lib/errors';
import { db } from '@/lib/firestore';

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
  /*
   * `?now=<ISO>` moves the clock for a local run, so E3 and the Thursday
   * reminder can be watched without waiting five days. Ignored in production.
   */
  const fake = request.nextUrl.searchParams.get('now');
  const nowMs = process.env.NODE_ENV !== 'production' && fake ? Date.parse(fake) : Date.now();
  try {
    const report = await runCfpSchedule(Number.isFinite(nowMs) ? nowMs : Date.now());
    /*
     * So the Email Log's Scheduled tab can tell a timer that runs from one
     * that stopped (T274). The real clock, never `?now=`, and never allowed to
     * turn a finished run into a failure.
     */
    await db()
      .collection(COLLECTIONS.settings)
      .doc(CRON_STATUS_DOC)
      .set({ lastRunAtMs: Date.now(), failures: report.failures.length })
      .catch((err) => recordError('cfp.cron.status', err));
    return NextResponse.json(report);
  } catch (err) {
    recordError('cfp.cron', err);
    return NextResponse.json({ error: 'The run failed. See the dashboard error log.' }, { status: 500 });
  }
}
