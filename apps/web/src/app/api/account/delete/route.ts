import { consumeSignInCode, type ConsumeOutcome } from '@kgc/scripts/src/lib/otp-core';
import { callerIpFromHeaders } from '@kgc/scripts/src/lib/rate-limit';
import { NextResponse, type NextRequest } from 'next/server';

import { deleteAccountData, uidForDeletion } from '@/lib/account-deletion-core';
import { uidForEmail } from '@/lib/app-account-core';
import { corsHeaders } from '@/lib/auth-cors';
import { recordError } from '@/lib/errors';
import { adminAuth, db } from '@/lib/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `POST /api/account/delete`: delete the caller's app account.
 *
 * Two ways to prove whose account it is, and nothing else is accepted:
 *
 *  - **From the app:** `Authorization: Bearer <Firebase ID token>`. The uid is
 *    the token's. A body may name a `uid`, and if it names anyone else the
 *    request is refused rather than quietly applied to the caller, so a client
 *    bug can never look like success.
 *  - **From the web page** (`/account/delete`, which Google Play links to):
 *    `{ email, code }`, a code from `/api/auth/request-code`. It is checked and
 *    used up with `consumeSignInCode`, which signs nobody in, so the page never
 *    creates the account it is about to remove.
 *
 * What is removed and what is kept is in `lib/account-deletion-core.ts`.
 * Running it twice is safe: the second run finds nothing and still answers 200.
 */

const CODE_FAILURES: Record<Extract<ConsumeOutcome, { ok: false }>['reason'], { status: number; message: string }> = {
  'invalid-argument': { status: 400, message: 'Enter your email address and the 6-digit code.' },
  'wrong-code': { status: 400, message: 'That code is not right. Check the email and try again.' },
  'no-code': { status: 400, message: 'There is no active code for this address. Ask for a new one.' },
  expired: { status: 400, message: 'That code has expired. Ask for a new one.' },
  exhausted: { status: 429, message: 'Too many wrong codes. Ask for a new one.' },
  'resource-exhausted': { status: 429, message: 'Too many attempts. Try again later.' },
};

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req.headers.get('origin'));
  const fail = (status: number, error: string, message: string) =>
    NextResponse.json({ error, message }, { status, headers: cors });

  let body: { uid?: unknown; email?: unknown; code?: unknown } = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return fail(400, 'invalid-argument', 'The request was not readable.');
  }

  let uid: string;
  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (bearer) {
    try {
      // No revocation check: a person retrying a half-finished deletion must
      // still be let in, and the token proves who they are either way.
      uid = (await adminAuth().verifyIdToken(bearer)).uid;
    } catch {
      return fail(401, 'unauthenticated', 'Sign in again, then delete your account.');
    }
    if (body.uid !== undefined && body.uid !== uid) {
      return fail(403, 'permission-denied', 'You can only delete your own account.');
    }
  } else if (body.email !== undefined || body.code !== undefined) {
    const result = await consumeSignInCode(db(), String(body.email ?? ''), String(body.code ?? ''), callerIpFromHeaders(req.headers));
    if (!result.ok) {
      const f = CODE_FAILURES[result.reason];
      return fail(f.status, result.reason, f.message);
    }
    uid = await uidForDeletion(adminAuth(), result.email, uidForEmail(result.email));
  } else {
    return fail(401, 'unauthenticated', 'Sign in, or confirm your email address with a code.');
  }

  try {
    const counts = await deleteAccountData(adminAuth(), db(), uid);
    return NextResponse.json({ deleted: true, counts }, { headers: cors });
  } catch (err) {
    await recordError('account.delete', err, { path: 'users', id: uid });
    return fail(500, 'internal', 'Your account could not be deleted. Try again, or email contact@knowledgegraph.tech.');
  }
}
