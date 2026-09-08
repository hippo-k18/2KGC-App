import { callerIpFromHeaders } from '@kgc/scripts/src/lib/rate-limit';
import { requestSignInCode } from '@kgc/scripts/src/lib/otp-core';
import { NextResponse, type NextRequest } from 'next/server';

import { corsHeaders } from '@/lib/auth-cors';
import { db } from '@/lib/firestore';

/**
 * "Email me a sign-in code" — the endpoint the attendee app's **Create account**
 * button calls.
 *
 * ── Why this lives on the website and not in `functions/` ──────────────────
 *
 * It is the same logic, and it is deliberately not a second copy:
 * `@kgc/scripts/src/lib/otp-core.ts` holds every rule and
 * `functions/src/callable/request-otp.ts` calls the identical function. What
 * differs is only that this one **deploys**. Deploying a Cloud Function on this
 * project needs `iam.serviceAccounts.ActAs`, which only `roles/owner` can grant
 * and nobody has (OWNER-ACTIONS.md §3), so the callable has never served a real
 * request. This site is already trusted server-side — it holds the Admin SDK
 * credential and the Resend key and it provisions attendee accounts on
 * purchase — so serving sign-in from it adds no privilege it did not have.
 *
 * ── The response is the same for every valid address ───────────────────────
 *
 * `{ ok: true }` whether or not the address holds a ticket, whether or not the
 * mailbox exists, whether or not the send succeeded. That is an
 * anti-enumeration property, not politeness: an endpoint whose answer varies
 * with whether an address is on the guest list turns "send me a code" into a
 * query against a $1,199-a-seat delegate list. The two observable failures are
 * a malformed address and having asked too often, neither of which says
 * anything about somebody else.
 *
 * ⚠️ Do not add a "we couldn't find that email" branch. It is the one change
 * that would undo the whole design, and it is the change that will be
 * suggested, because the endpoint looks unhelpful without it.
 *
 * `force-dynamic` because this writes on every call and must never be prerendered
 * or cached; `nodejs` because the Admin SDK is not edge-compatible.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req.headers.get('origin'));

  let email = '';
  try {
    const body = (await req.json()) as { email?: unknown };
    email = String(body?.email ?? '');
  } catch {
    // A body that is not JSON is the same class of problem as a malformed
    // address, and is answered the same way.
    return NextResponse.json(
      { error: 'invalid-argument', message: 'A valid email address is required.' },
      { status: 400, headers: cors },
    );
  }

  const result = await requestSignInCode(db(), email, callerIpFromHeaders(req.headers));

  if (result.ok) return NextResponse.json({ ok: true }, { headers: cors });

  if (result.reason === 'invalid-argument') {
    return NextResponse.json(
      { error: 'invalid-argument', message: 'A valid email address is required.' },
      { status: 400, headers: cors },
    );
  }
  return NextResponse.json(
    { error: 'resource-exhausted', message: 'Too many code requests for this address. Try again later.' },
    { status: 429, headers: cors },
  );
}
