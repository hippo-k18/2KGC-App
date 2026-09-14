import { icsFilename, sessionIcs } from '@/lib/calendar';
import { listAgenda } from '@/lib/data';
import { recordError } from '@/lib/errors';

/**
 * `GET /agenda/{sessionId}/calendar.ics` — one published session as a download.
 *
 * ── Why this is not under `/api` ────────────────────────────────────────────
 *
 * Everything in `app/api/` is a machine endpoint: a Stripe webhook, the OTP
 * exchange, RFC 8058's one-click unsubscribe. None of them is a URL a person
 * ever sees. This one is the opposite — it is an address an attendee clicks,
 * pastes into a message and prints on a slide, and it is a *representation of
 * the session* rather than a service. So it hangs off the resource, the way
 * `/u/{token}` and `/r/{code}` hang off theirs, and the filename is in the path
 * rather than only in a header: a client that ignores `Content-Disposition`
 * still saves something ending in `.ics` and still opens in a calendar.
 *
 * ⚠️ `force-dynamic` is not decoration. The segment is dynamic and the handler
 * reads Firestore, and without it a build with credentials in the environment
 * is free to evaluate what it can and serve a programme frozen at build time —
 * the same reason `agenda/page.tsx` carries the line. A session moved to
 * another room at 08:00 on the day must reach the person who downloads it at
 * 08:05.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const sessionId = decodeURIComponent(id);

  /*
   * The programme is read through `listAgenda()` rather than by fetching the
   * document directly, which costs a collection read this route could have
   * avoided. It buys the one property worth paying for: whatever "published"
   * means, it means the same thing here as on `/agenda`. A second copy of
   * `status === 'published' && !deletedAt && eventId` is a second place for a
   * draft session to leak from, and this one would leak it as a file that keeps
   * working after the session is withdrawn. Seventy-odd documents; the agenda
   * page does exactly this on every render.
   */
  const days = await listAgenda();
  const session = days.flatMap((d) => d.sessions).find((s) => s.id === sessionId);

  /*
   * Unpublished and nonexistent are the same answer on purpose. Distinguishing
   * them would let anyone with a session id learn that a talk exists in draft,
   * which is programme-committee information.
   */
  if (!session) {
    return new Response('No published session with that id.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  let body: string;
  try {
    body = sessionIcs(session);
  } catch (err) {
    /*
     * `sessionIcs` throws only on a session whose stored times are malformed or
     * inverted, which is a data fault an organizer has to fix — so it goes to
     * the audit feed the dashboard renders rather than dying in a log. Not a
     * 404: the session is genuinely there, and telling the attendee it is not
     * sends them to look for it on a page that lists it.
     */
    await recordError('agenda.calendar.ics', err, { path: 'sessions', id: sessionId });
    return new Response('This session could not be turned into a calendar entry.', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${icsFilename(session.title)}"`,
      // Short, not zero: the programme does change during the conference, and a
      // stale entry is the failure this whole route exists to prevent. Long
      // enough that a link shared into a busy channel is not seventy reads.
      'Cache-Control': 'public, max-age=300',
    },
  });
}
