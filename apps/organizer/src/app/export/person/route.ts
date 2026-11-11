import type { NextRequest } from 'next/server';
import { exportAccess } from '@/lib/auth';
import { recordError } from '@/lib/errors';
import { personExport, resolvePerson } from '@/lib/person-data';
import { exportFilename } from '@/lib/person-data-core';

export const dynamic = 'force-dynamic';

/**
 * Everything held about one person, as a JSON file.
 *
 * A sibling of `/export/{kind}` rather than another entry in it, because the
 * eight CSV exports answer "give me the attendee list" and this one answers
 * "give me *me*". They differ in shape — a subject access file is nested, not a
 * table — and in who it goes to: a CSV is handed to a caterer, and this is
 * handed to the person it describes.
 *
 * A static segment beside a dynamic one, so Next routes `/export/person` here
 * and `/export/attendees` to `[kind]`.
 *
 * ── The same two reasons `[kind]/route.ts` gives ────────────────────────────
 *
 * It is outside the `(dash)` group, so it does not inherit the layout's
 * `requireOrganizer()` and has to do its own — and forgetting that would put
 * one person's entire file, messages included, on a public URL.
 * `exportAccess('person')` names no role in `EXPORT_ROLE`, so it is an owner's:
 * a check-in volunteer can open the door and cannot download somebody's
 * conversations.
 */
export async function GET(req: NextRequest) {
  const access = await exportAccess('person');
  if (access === 'signed-out') {
    return new Response('Not signed in.\n', {
      status: 401,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
  if (access === 'forbidden') {
    return new Response('Your role does not include this export.\n', {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  const rid = req.nextUrl.searchParams.get('rid') ?? undefined;
  const uid = req.nextUrl.searchParams.get('uid') ?? undefined;
  if (!rid && !uid) {
    return new Response('Name the attendee to export.\n', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  try {
    const identity = await resolvePerson({ registrationId: rid, uid });
    if (!identity) {
      return new Response('That attendee is no longer on the list.\n', {
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    const on = new Date();
    const file = await personExport(identity, on);
    return new Response(JSON.stringify(file, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${exportFilename(identity.name, identity.email, on)}"`,
        // One person's whole record, messages included. Nothing may cache it —
        // not the browser, not a proxy, not Netlify's edge.
        'Cache-Control': 'no-store, private',
      },
    });
  } catch (err) {
    recordError('person.export', err);
    return new Response('That export did not finish. Try again.\n', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
