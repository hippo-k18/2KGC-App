import { exportFilename, leadsCsv } from '@kgc/shared';
import { listLeads, openLeadDesk } from '@/lib/exhibitor-leads';
import { siteEvent } from '@/lib/data';

/**
 * `GET /exhibitor/{token}/leads.csv` — one stand's own leads as a file.
 *
 * ── Why a route rather than a button that builds a blob ─────────────────────
 *
 * The same reason `/agenda/{id}/calendar.ics` is one, and one more. It is an
 * address, so a stand can open it on the phone they scanned with and mail it to
 * the laptop they will actually work from, and the filename is in the path so a
 * client that ignores `Content-Disposition` still saves something ending in
 * `.csv`. The extra reason here is that a download built in the browser would
 * mean the whole lead list had already been shipped to the page as data,
 * whether or not anybody pressed anything.
 *
 * ⚠️ It makes the **same** `openLeadDesk` check as the page. A revoked link has
 * to stop the download as well as the screen, or "revoke" means "they can no
 * longer add to the list they can still download".
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  const rawToken = decodeURIComponent(token);

  const grant = await openLeadDesk(rawToken);
  if (!grant) {
    return new Response('This link is no longer valid.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const [leads, ev] = await Promise.all([listLeads(rawToken), siteEvent()]);
  const csv = leadsCsv(leads ?? [], ev.timeZone);

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportFilename(
        `leads-${grant.exhibitorId}`,
        new Date(),
      )}"`,
      // Contact details for real people. Nothing may cache them — not the
      // browser, not a proxy, not Netlify's edge.
      'Cache-Control': 'no-store, private',
    },
  });
}
