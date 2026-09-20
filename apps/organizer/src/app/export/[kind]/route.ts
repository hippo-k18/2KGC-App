import type { NextRequest } from 'next/server';
import { exportAccess } from '@/lib/auth';
import { csvResponse, exportFilename } from '@/lib/csv';
import { exportByKind } from '@/lib/exports';

export const dynamic = 'force-dynamic';

/**
 * CSV downloads.
 *
 * A route handler rather than a server action, because a download needs real
 * response headers — `Content-Disposition` is what makes a browser save a file
 * instead of rendering it, and a server action cannot set one.
 *
 * ── This is outside the (dash) group on purpose ─────────────────────────────
 *
 * The dashboard layout wraps every page in Whova's chrome. A CSV must not be
 * wrapped in anything, so it lives at `/export/{kind}` rather than under the
 * group — which means it does **not** inherit the layout's `requireOrganizer()`
 * call and has to do its own. That is the whole reason for the check below, and
 * forgetting it would put the entire attendee list, with every email address,
 * on a public URL.
 *
 * `exportAccess()` rather than `requireOrganizer()`: the latter redirects to
 * the login page, and a 307 to an HTML page is a confusing thing to receive
 * when you asked for a file. A 401 says what happened.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  const access = await exportAccess(kind);
  if (access === 'signed-out') {
    return new Response('Not signed in.\n', {
      status: 401,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
  // A team member whose roles do not cover the screen this file belongs to.
  if (access === 'forbidden') {
    return new Response('Your role does not include this export.\n', {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  const def = exportByKind(kind);
  if (!def) {
    return new Response(`No export called "${kind}".\n`, {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // `?category=` is the attendee list's filter, carried into the file.
  const category = req.nextUrl.searchParams.get('category') ?? undefined;
  const { csv } = await def.build({ category });
  return csvResponse(csv, exportFilename(def.kind, new Date()));
}
