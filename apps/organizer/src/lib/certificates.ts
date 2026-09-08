import 'server-only';

import { COLLECTIONS, EVENT, EVENT_ID, type CertificateDoc } from '@kgc/shared';
import { db } from './firestore';
import { recordError } from './errors';

/**
 * Issued attendance certificates.
 *
 * ── Why a certificate is a stored document and not a rendered view ──────────
 *
 * It would be easy to render a certificate straight from `attendeeAttendance()`
 * on every page load, and it would be wrong. A certificate names hours somebody
 * may claim professional credit for: once it has been printed and handed over,
 * a later scan landing on the same session must not silently change what the
 * paper in their file says. So the hours, the session titles, the wording and
 * the signatory are **copied at issue time**, and the document is what gets
 * printed thereafter.
 *
 * ── Keyed by registration, so re-issuing corrects rather than duplicates ────
 *
 * The opposite of the `checkIns` rule next door, deliberately. A check-in is an
 * event that happened at a time and must never be restamped, which is why its
 * `create()` failing with `already-exists` *is* the deduplication. A
 * certificate is a statement about the record, and two contradictory statements
 * about one person's hours is the failure worth avoiding — so a re-issue
 * overwrites, and the audit log carries what it was before.
 */

function iso(t: { toDate(): Date } | undefined): string | undefined {
  try {
    return t?.toDate().toISOString();
  } catch {
    return undefined;
  }
}

/** The wording an organizer starts from. Editable, and pinned once issued. */
export const DEFAULT_STATEMENT = `attended ${EVENT.name} at ${EVENT.venue}.`;

/**
 * The mark an organizer starts from, served from this app's own `public/`.
 *
 * ── Why this file and not the one in the header ─────────────────────────────
 *
 * The dashboard header renders `public/kgc/wordmark-white.png`, and reusing it
 * here would print nothing at all: it is white artwork on transparency (mean
 * luminance 222/255 across its opaque pixels), drawn to sit on the `#2180b2`
 * bar. A certificate is dark ink on white paper, so the white wordmark is the
 * one KGC asset in this repo that is guaranteed invisible on it.
 * `apps/web/public/kgc/cropped-White-Wordmark-2.png`, which that header asset
 * was resampled from, is white for the same reason and fails the same way.
 *
 * `logo-colour.png` is the full-colour lockup — the KGC monogram over "The
 * Knowledge Graph Conference" — copied byte for byte from
 * `apps/web/public/kgc-logo.png`, where it is the website's light-background
 * logo. It is dark (mean luminance 91/255) on transparency, so it prints on
 * white, and at 400×207 it lands about 310 dpi in print: `.cert-logo`'s
 * `max-height: 64px` renders it 124×64 CSS px, which is 33 mm wide on paper.
 * The two websites cannot import each other's `public/`, hence a copy rather
 * than a reference.
 *
 * ── Why a path and not a Storage URL ────────────────────────────────────────
 *
 * Nothing outside this dashboard ever renders a certificate — they are printed
 * here, not emailed — so a same-origin path resolves everywhere the document is
 * read, needs no bucket, and cannot be changed by an organizer. An upload
 * through `lib/uploads.ts` still overrides it and is still stored as the
 * Firebase Storage download URL it always was.
 */
export const DEFAULT_LOGO_URL = '/kgc/logo-colour.png';

export interface CertificateRow {
  registrationId: string;
  name: string;
  email: string;
  minutes: number;
  sessionTitles: string[];
  statement: string;
  signatoryName: string;
  signatoryRole: string;
  logoUrl?: string;
  issuedAt?: string;
  issuedBy: string;
}

export async function listCertificates(): Promise<CertificateRow[]> {
  try {
    const snap = await db()
      .collection(COLLECTIONS.certificates)
      .where('eventId', '==', EVENT_ID)
      .get();

    return snap.docs
      .map((d) => {
        const c = d.data() as CertificateDoc;
        return {
          registrationId: c.registrationId ?? d.id,
          name: c.name ?? '',
          email: c.email ?? '',
          minutes: c.minutes ?? 0,
          sessionTitles: c.sessionTitles ?? [],
          statement: c.statement ?? '',
          signatoryName: c.signatoryName ?? '',
          signatoryRole: c.signatoryRole ?? '',
          logoUrl: c.logoUrl,
          issuedAt: iso(c.issuedAt),
          issuedBy: c.issuedBy ?? '',
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    recordError('certificates.list', err);
    return [];
  }
}

/**
 * The wording of the last issue, so the form comes back holding it.
 *
 * Read off the most recently issued certificate rather than kept in a settings
 * bag: the wording that matters is the one people were actually given, and
 * storing it twice invites the two copies to disagree about what was printed.
 *
 * ⚠️ The logo defaults on the branch where **nothing has been issued yet**, and
 * not on `latest.logoUrl` being absent, which is the difference between a
 * default and an override. Once a run exists, that run's answer is the truth,
 * including "no mark" — an organizer who cleared it with the picker's Remove
 * and re-issued would otherwise find it back on the next visit, which is the
 * form silently disagreeing with the paper it just printed.
 */
export function lastWording(rows: CertificateRow[]): {
  statement: string;
  signatoryName: string;
  signatoryRole: string;
  logoUrl?: string;
} {
  const latest = [...rows]
    .filter((r) => r.issuedAt)
    .sort((a, b) => (b.issuedAt ?? '').localeCompare(a.issuedAt ?? ''))[0];

  return {
    statement: latest?.statement || DEFAULT_STATEMENT,
    signatoryName: latest?.signatoryName ?? '',
    signatoryRole: latest?.signatoryRole ?? '',
    logoUrl: latest ? latest.logoUrl : DEFAULT_LOGO_URL,
  };
}
