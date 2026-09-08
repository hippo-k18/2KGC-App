import { normaliseEmail, otpDocId } from '@kgc/scripts/src/lib/otp-ids';
import { COLLECTIONS } from '@kgc/shared';
import type { OtpCodeDoc } from '@kgc/shared';
import { NextResponse, type NextRequest } from 'next/server';

import { corsHeaders } from '@/lib/auth-cors';
import { demoCheckoutAllowed } from '@/lib/demo-checkout';
import { db } from '@/lib/firestore';

/**
 * Reads back the sign-in code that was just issued — **on a localhost dev
 * server only**, and never anywhere else.
 *
 * ── Why this exists, which is a real problem and not convenience ───────────
 *
 * The sign-in code is delivered by email, and on this project email does not
 * currently arrive. Resend answers every send with
 *
 *   403 The knowledgegraph.tech domain is not verified
 *
 * and records it in `emailLog` as `failed`. Nothing else is wrong: the code is
 * generated, stored and valid, and `verify-code` will accept it. It simply has
 * no way of reaching the person who asked for it, which makes "Create account"
 * a dead end during a demo — the one place where stopping to debug is not
 * available. Verifying the domain in Resend is the actual fix and it is an
 * owner action; this is what makes the flow demonstrable until then.
 *
 * ── The gate ──────────────────────────────────────────────────────────────
 *
 * `demoCheckoutAllowed()`, the same one on the rehearsal buy button, and for
 * the same reasons — read its header. The load-bearing half is
 * `NODE_ENV !== 'production'`, which is fixed at **build** time: `next build`
 * sets it, so on Netlify this handler is a compile-time `false` and everything
 * below it is unreachable code. No environment variable and no header can turn
 * it back on. The host check is the weaker, readable half, and stops a
 * `next dev` exposed through a tunnel from serving codes to strangers.
 *
 * Reusing that function rather than writing a second gate is deliberate: two
 * gates are two things to keep in step, and the first demo after they diverged
 * would be the one that leaked.
 *
 * ⚠️ **This endpoint discloses a live credential**, which is exactly what the
 * rest of this codebase refuses to do — `otp-core.ts` will not even log the
 * code, because Cloud Logging is not a delivery channel. That refusal is about
 * *deployed* surfaces, and this cannot be one. If you find yourself wanting a
 * version of this that runs in production, the thing you actually want is a
 * verified sending domain.
 *
 * ⚠️ It deliberately does **not** say whether the address holds a ticket, and
 * it does not create, extend or consume a code. It is a read. The
 * anti-enumeration design in `otp-core.ts` is untouched by it, and must stay
 * that way even here — a demo affordance that answered "no such attendee"
 * would be a habit worth not forming.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const cors = corsHeaders(req.headers.get('origin'));

  if (!(await demoCheckoutAllowed())) {
    // 404 rather than 403: a deployment should not admit that this route was
    // ever compiled, and "forbidden" is an admission.
    return new NextResponse(null, { status: 404 });
  }

  const email = normaliseEmail(req.nextUrl.searchParams.get('email') ?? '');
  if (!email) {
    return NextResponse.json({ error: 'invalid-argument' }, { status: 400, headers: cors });
  }

  const snap = await db().collection(COLLECTIONS.otpCodes).doc(otpDocId(email)).get();
  if (!snap.exists) {
    return NextResponse.json({ code: null, reason: 'no-active-code' }, { headers: cors });
  }

  const data = snap.data() as OtpCodeDoc;
  return NextResponse.json(
    {
      code: data.code,
      email: data.email,
      expiresAt: data.expiresAt.toDate().toISOString(),
      attempts: data.attempts,
    },
    { headers: cors },
  );
}
