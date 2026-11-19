import { NextResponse, type NextRequest } from 'next/server';
import { currentAccess } from '@/lib/auth';
import { listAccess } from '@/lib/change-requests-access';
import { SHOT_CSP, contentTypeForPath } from '@/lib/change-requests-core';
import { readScreenshot } from '@/lib/change-requests';
import { recordError } from '@/lib/errors';

/**
 * `GET /tools/change-requests/{id}/shot/{n}`: one screenshot a sender
 * attached (T428), for a signed-in organizer only.
 *
 * The objects have no download token and Storage refuses every client, so
 * this is the only way to see one. It answers 401 to nobody signed in and 403
 * to a team role that cannot open the screen. The content type comes from the
 * stored path, which was chosen from the file's own bytes, and only ever names
 * a PNG, JPEG or WebP; `nosniff` stops a browser second-guessing it. The
 * sandbox CSP is also set for this path in `next.config.ts`, because the
 * global header there would otherwise replace this one (gate T429).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; n: string }> }) {
  const access = await currentAccess();
  const code = listAccess(access?.roles ?? null);
  if (code !== 200) {
    return new NextResponse(code === 401 ? 'Sign in to see this.' : 'Not allowed.', {
      status: code,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const { id, n } = await params;
  // Exactly 1, 2 or 3: `01` and `1.0` are not the first screenshot (T430).
  if (!/^[A-Za-z0-9]{10,40}$/.test(id) || !/^[1-3]$/.test(n)) {
    return new NextResponse('Not found.', { status: 404 });
  }

  try {
    const shot = await readScreenshot(id, Number(n) - 1);
    const type = shot && contentTypeForPath(shot.path);
    if (!shot || !type) return new NextResponse('Not found.', { status: 404 });
    return new NextResponse(new Uint8Array(shot.bytes), {
      headers: {
        'Content-Type': type,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': SHOT_CSP,
        'Content-Disposition': `inline; filename="change-request-${id}-${n}.${type.split('/')[1].replace('jpeg', 'jpg')}"`,
      },
    });
  } catch (err) {
    recordError('change-requests.shot', err);
    return new NextResponse('Could not load the screenshot.', { status: 500 });
  }
}
