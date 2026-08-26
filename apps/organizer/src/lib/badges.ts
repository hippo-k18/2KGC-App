import 'server-only';

import { COLLECTIONS, EVENT_ID, type RegistrationDoc, type UserDoc } from '@kgc/shared';
/**
 * The badge QR is drawn with the attendee app's own encoder.
 *
 * Not a second copy and not an npm package: `app/src/lib/qr/encode.ts` is a
 * pure function with no dependencies, no network and no state, and it is the
 * encoder whose output the door scanner already reads every day. A second
 * implementation here would be a second thing that can disagree with the phone
 * screen, and the day they disagree is the day a printed badge stops scanning
 * while somebody holds it at the desk — the same argument AGENTS.md makes
 * against a second copy of `ensureRegistration`.
 *
 * The relative path is ugly because `apps/organizer` is deliberately not a
 * workspace member, so there is no package specifier to reach the app by. That
 * is the cost of the arrangement, paid once here rather than avoided by
 * duplicating 500 lines of Reed–Solomon.
 */
import { encodeQr } from '../../../../app/src/lib/qr/encode';
import { db } from './firestore';

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
 * One QR symbol as a single SVG path.
 *
 * A path rather than one `<rect>` per module: a version-3 symbol is 29×29, so a
 * sheet of 25 badges is ~10,000 rects of markup against 25 path strings. The
 * browser is the print pipeline here — there is no image step, no server-side
 * rasteriser and nothing to install — so the size of the document it has to lay
 * out is the whole performance budget.
 *
 * Coordinates are in module units and the caller scales with `viewBox`, which
 * keeps the symbol crisp at any printer resolution: a vector QR has no pixel
 * grid to fight with the printer's.
 */
export function badgeQr(qrSecret: string): { d: string; size: number } {
  const m = encodeQr(qrSecret, 'M');
  const parts: string[] = [];

  for (let r = 0; r < m.size; r++) {
    let c = 0;
    while (c < m.size) {
      if (!m.modules[r][c]) {
        c++;
        continue;
      }
      // Runs of dark modules merge into one rectangle, which roughly halves the
      // path length again on the dense rows through the middle of a symbol.
      let run = 1;
      while (c + run < m.size && m.modules[r][c + run]) run++;
      parts.push(`M${c} ${r}h${run}v1h-${run}z`);
      c += run;
    }
  }

  return { d: parts.join(''), size: m.size };
}

/**
 * The quiet zone, in modules, required by the spec on all four sides.
 *
 * Four is the standard minimum. It is not decoration — a symbol printed hard
 * against the edge of a badge, or against a coloured band, is a symbol many
 * handheld readers will not find at all.
 */
export const QR_QUIET_ZONE = 4;
