import 'server-only';

import { COLLECTIONS, EVENT_ID, type RegistrationDoc, type UserDoc } from '@kgc/shared';
import { db } from './firestore';
/**
 * The badge QR is drawn with the attendee app's own encoder, reached through
 * `./qr` — which holds the reasoning for why it is that encoder and not a
 * second one, and which is now the single path builder in this app rather than
 * the two that used to sit here and in `apps/web`.
 */
import { qrPath } from './qr';

/**
 * Data and geometry for Attendees → Name Badges.
 *
 * ── The row type has no email field, and that is the point ──────────────────
 *
 * A badge is held up in a hall, photographed, and left on a table. AGENTS.md
 * settles what may appear on one: the QR payload is `qrSecret` alone, never an
 * email, never a uid, never a `registrationId`. Rather than restate that as a
 * rule the badge template is trusted to follow, `BadgeRow` simply does not
 * carry an address or an id that identifies a person — a template cannot print
 * a field it was never given, and a future edit to the template cannot leak one
 * without first changing this file and reading this comment.
 *
 * `claimCode` is absent for a related reason and it is a decision, not an
 * oversight. `RegistrationDoc.claimCode` describes itself as printable on a
 * badge, but it is a **sign-in** credential while `qrSecret` grants attendance
 * and nothing else. Printing both on one piece of card collapses the separation
 * the two fields exist to maintain: photograph that badge and you are not
 * merely checked in as somebody, you are signed in as them. The accepted threat
 * in AGENTS.md is the first and explicitly not the second.
 */

export interface BadgeRow {
  /** Opaque server-minted id. Shown nowhere on the badge — it is a filter key. */
  registrationId: string;
  name: string;
  company?: string;
  title?: string;
  ticketType?: string;
  status: RegistrationDoc['status'];
  /** The whole QR payload. Never rendered as text. */
  qrSecret: string;
}

/**
 * Every registration, with the company and job title the app knows about.
 *
 * Two queries, each a single `where('eventId', '==', …)`, joined in memory on
 * the lower-cased email address. The rule is the one every read in this
 * dashboard follows: a `where` plus an `orderBy` on a second field needs a
 * composite index entry this repo does not declare, the emulator does not
 * enforce indexes, so such a query passes locally and fails in production with
 * `failed-precondition`. AGENTS.md records two screens shipping broken exactly
 * that way. Fifty-odd documents sort in microseconds here instead.
 *
 * The email addresses used for the join are local variables and never reach the
 * returned rows, for the reason in the header above.
 */
export async function listBadgeRows(): Promise<BadgeRow[]> {
  const [regSnap, userSnap] = await Promise.all([
    db().collection(COLLECTIONS.registrations).where('eventId', '==', EVENT_ID).get(),
    db().collection(COLLECTIONS.users).where('eventId', '==', EVENT_ID).get(),
  ]);

  const key = (e: string | undefined) => (e ?? '').trim().toLowerCase();
  const profiles = new Map<string, { company?: string; title?: string; name: string }>();
  for (const d of userSnap.docs) {
    const u = d.data() as UserDoc;
    profiles.set(key(u.email), { company: u.company, title: u.title, name: u.name });
  }

  return regSnap.docs
    .map((d) => {
      const r = d.data() as RegistrationDoc;
      const p = profiles.get(key(r.email));
      return {
        registrationId: d.id,
        /**
         * The registration's own name wins over the profile's. It is what the
         * buyer typed at checkout, and a badge that disagrees with the name on
         * the ticket is an argument at the desk.
         */
        name: r.name ?? p?.name ?? '(no name yet)',
        company: p?.company,
        title: p?.title,
        ticketType: r.ticketType,
        status: r.status,
        qrSecret: r.qrSecret,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * One badge symbol as a single SVG path, at error-correction level M.
 *
 * A named wrapper rather than a direct `qrPath` call at the call site, because
 * the argument is a credential: a screen that reaches for `badgeQr` is holding
 * a `qrSecret`, and the type of the thing it prints is worth stating in the
 * name. Level M is the badge's level — see `./qr` for why a link QR uses Q.
 */
export function badgeQr(qrSecret: string): { d: string; size: number } {
  return qrPath(qrSecret, 'M');
}

/**
 * Re-exported so a badge screen imports its geometry from one place.
 *
 * The constant itself lives in `./qr` beside the path builder that assumes it.
 */
export { QR_QUIET_ZONE } from './qr';
