import 'server-only';

import { headers } from 'next/headers';

/**
 * The gate on the rehearsal button — the one that issues a ticket without
 * taking a payment.
 *
 * ── Why this needs a gate at all ────────────────────────────────────────────
 *
 * This is the branch `lib/stripe.ts` describes deleting. It existed as
 * `DEMO_MODE=1`, it completed the registration without a payment processor, and
 * the argument for removing it was exactly right: a deployment that can be
 * reached by strangers and hands out free tickets is a deployment that hands
 * out free tickets. Nothing about that argument has changed. What has changed
 * is the need — a demo has to show the whole path, including the receipt, the
 * app account and the sold counter moving, and a Stripe test card only reaches
 * half of it while no webhook is listening.
 *
 * So the branch comes back, and the whole of its safety is that it cannot exist
 * anywhere a stranger can reach.
 *
 * ── Two conditions, one of which cannot be forged ───────────────────────────
 *
 * **`NODE_ENV !== 'production'`** is the load-bearing one. It is fixed at build
 * time, not read from the environment at runtime, and `next build` sets it to
 * `production` — so on the Netlify sites this function is a compile-time
 * constant `false` and everything behind it is unreachable code. No env var
 * anybody sets on the deploy, and no header anybody sends, can turn it back on.
 *
 * **The host check** is the readable one, and deliberately the weaker of the
 * two. `Host` arrives from the client and can say anything, which is precisely
 * why it is not trusted on its own. It is here so that a `next dev` run exposed
 * on a LAN address or through a tunnel — the ngrok dependency in the root
 * `package.json` is not hypothetical — does not quietly offer free tickets to
 * whoever has the link.
 *
 * There is no environment variable. A variable is a thing that can be set by
 * accident on the wrong deployment, and the point of this file is that there is
 * no accident available.
 */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export async function demoCheckoutAllowed(): Promise<boolean> {
  if (process.env.NODE_ENV === 'production') return false;

  const host = (await headers()).get('host') ?? '';
  // Strip the port: `localhost:3200` and `localhost` are the same machine.
  const hostname = host.replace(/:\d+$/, '').toLowerCase();
  return LOCAL_HOSTS.includes(hostname);
}
