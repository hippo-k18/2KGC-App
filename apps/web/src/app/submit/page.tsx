import { redirect } from 'next/navigation';
import { shownCall } from '@/lib/data';
import { submitTarget } from '@/lib/submit-redirect';

/** Per request, so the target follows the dashboard's "Show on website" switch. */
export const dynamic = 'force-dynamic';

/**
 * `/submit` is the address people guess for the call page (T372). A temporary
 * redirect (307), so browsers do not cache it and next year's call can take
 * over. `/submit/` reaches it through the middleware's trailing-slash 308.
 * Not a middleware rewrite: behind Apache `request.url` is
 * `https://localhost:…`, which Next proxies over TLS to a plain-HTTP port and
 * answers 500 (T374).
 */
export default async function SubmitIndex({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [call, params] = await Promise.all([shownCall(), searchParams]);
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) query.append(k, one);
  }
  redirect(submitTarget(call?.id, query.toString()));
}
