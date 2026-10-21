import 'server-only';

import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

/**
 * `Authorization: Bearer $CRON_SECRET`, for the routes the droplet's timers
 * post to (`/api/cron/*`). No secret configured, or one shorter than 16
 * characters, refuses everything, so a deployment that has not set it up
 * cannot be poked into publishing or mailing.
 */
export function cronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? '';
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return secret.length >= 16 && a.length === b.length && timingSafeEqual(a, b);
}
