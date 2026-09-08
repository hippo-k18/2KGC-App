import { verifySignInCode, type VerifyOutcome } from '@kgc/scripts/src/lib/otp-core';
import { callerIpFromHeaders } from '@kgc/scripts/src/lib/rate-limit';
import { NextResponse, type NextRequest } from 'next/server';

import { corsHeaders } from '@/lib/auth-cors';
import { adminAuth, db } from '@/lib/firestore';

/**
 * Redeem a six-digit code and hand back a Firebase custom token.
 *
 * The app exchanges that token with `signInWithCustomToken`. See
 * `request-code/route.ts` beside this for why sign-in is served from the
 * website, and `@kgc/scripts/src/lib/otp-core.ts` for every rule this enforces
 * — the brute-force cap, the claims policy, and the ticket check.
 *
 * ── This is where the ticket check lives ───────────────────────────────────
 *
 * `requestSignInCode` deliberately never looks at `registrations`. This one
 * does, *after* the caller has proved they can read the mailbox, and refuses
 * with `no-registration` if there is no active ticket. That ordering is the
 * whole anti-enumeration design: the expensive answer is only given to somebody
 * who has already demonstrated they own the address they are asking about.
 *
 * ── Status codes ──────────────────────────────────────────────────────────
 *
 * A wrong code is **400, not 401**. 401 invites a browser or a proxy to attach
 * credential-recovery behaviour to a response that has nothing to do with HTTP
 * auth, and this endpoint uses no `WWW-Authenticate` scheme. 403 is reserved
 * for the one genuinely different outcome — a correct code held by somebody
 * with no ticket — because that is the only case where retrying cannot help.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reason → the status and the sentence the app shows. One table, no branching. */
const FAILURES: Record<
  Extract<VerifyOutcome, { ok: false }>['reason'],
  { status: number; message: string }
> = {
  'invalid-argument': { status: 400, message: 'A valid email and 6-digit code are required.' },
  'wrong-code': { status: 400, message: 'Incorrect code.' },
  'no-code': { status: 400, message: 'No active code for this email. Request a new one.' },
  expired: { status: 400, message: 'This code has expired. Request a new one.' },
  exhausted: { status: 429, message: 'Too many incorrect attempts. Request a new code.' },
  'resource-exhausted': { status: 429, message: 'Too many attempts. Try again later.' },
  'no-registration': { status: 403, message: 'No active registration found for this email.' },
};

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req.headers.get('origin'));

  let email = '';
  let code = '';
  try {
    const body = (await req.json()) as { email?: unknown; code?: unknown };
    email = String(body?.email ?? '');
    code = String(body?.code ?? '');
  } catch {
    return NextResponse.json(
      { error: 'invalid-argument', message: FAILURES['invalid-argument'].message },
      { status: 400, headers: cors },
    );
  }

  const result = await verifySignInCode(
    db(),
    adminAuth(),
    email,
    code,
    callerIpFromHeaders(req.headers),
  );

  if (result.ok) return NextResponse.json({ token: result.token }, { headers: cors });

  const failure = FAILURES[result.reason];
  return NextResponse.json(
    { error: result.reason, message: failure.message },
    { status: failure.status, headers: cors },
  );
}
