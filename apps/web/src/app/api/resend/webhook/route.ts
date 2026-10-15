import { recordDeliveryProblem } from '@/lib/resend-webhook';
import { readDeliveryProblem, verifySvixSignature } from '@/lib/resend-webhook-core';

/**
 * `POST /api/resend/webhook`: Resend tells us a mail bounced or was marked as
 * spam (T258 #9).
 *
 * Before this, a mistyped buyer address bounced in silence while the log said
 * `sent`, and a spam complaint was never suppressed. Configure it in Resend
 * with the `email.bounced` and `email.complained` events and put the signing
 * secret in `RESEND_WEBHOOK_SECRET`.
 *
 * ⚠️ Fails closed. With no secret set, every request is refused with 503, so a
 * forged "bounced" cannot suppress somebody's receipts. A bad or stale
 * signature is 401. Any other event type is acknowledged and ignored.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  // The raw body: the signature is over the exact bytes, not re-serialised JSON.
  const body = await request.text();
  const verdict = verifySvixSignature({
    secret: process.env.RESEND_WEBHOOK_SECRET,
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signature: request.headers.get('svix-signature'),
    body,
  });
  if (verdict === 'no-secret') {
    console.error('[resend-webhook] RESEND_WEBHOOK_SECRET is not set; refusing');
    return new Response('not configured', { status: 503 });
  }
  if (verdict !== 'ok') return new Response('invalid signature', { status: 401 });

  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const problem = readDeliveryProblem(event);
  if (!problem) return new Response(null, { status: 204 });

  try {
    await recordDeliveryProblem(problem);
  } catch (err) {
    // A 5xx makes Resend retry, which is what we want for a write that failed.
    console.error('[resend-webhook] could not record', problem.kind, err);
    return new Response('could not record', { status: 500 });
  }
  return new Response(null, { status: 204 });
}
