import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  type ExhibitorDoc,
  type SpeakerDoc,
  type SponsorDoc,
  type UserDoc,
} from '@kgc/shared';
import { recordError } from './errors';
import { db } from './firestore';

/**
 * Every image this project holds, counted.
 *
 * ── Why a whole module for a census ────────────────────────────────────────
 *
 * The three photo screens — Photo Collection, Photo Booth, Profile Photo Frames
 * — all sit behind the same blocker, and it is not the one people assume. It is
 * not that a gallery screen has not been written. It is that almost nothing in
 * this project uploads a file: nearly every image anywhere is a URL somebody
 * typed or an importer copied.
 *
 * That changed by exactly one field on 2026-08-30. `lib/uploads.ts` is the
 * upload path, and Exhibitor Manager is the single screen wired to it, which is
 * why `uploaded` below can now be non-zero. It is deliberately still derived
 * from the data rather than asserted — a screen that says "uploads work" and a
 * screen that says "3 of 61 images are ours" are different kinds of claim, and
 * only the second one can be checked.
 *
 * That is worth measuring rather than asserting. A screen saying "photos are
 * not built" is a claim; a screen saying "there are N images, M of them URLs on
 * somebody else's server, and K of them uploaded here" is a fact an organizer
 * can plan around — including the awkward one, which is that a conference whose
 * speaker headshots are hotlinked has a website that breaks when somebody's
 * blog moves.
 *
 * The numbers come from the data, which is the point: an earlier version of
 * this comment quoted "61 images, all of them URLs" as though it were fixed,
 * and by 2026-08-28 it was not — the *website* now serves 242 local files and
 * hotlinks nothing, and what remains offsite is sponsor and exhibitor logos on
 * Whova's own CDN, which arrive with the seed. Whatever this screen shows is
 * what is true when it is opened. Do not re-freeze a count into this comment.
 *
 * ── Same read rule as everywhere else ──────────────────────────────────────
 *
 * One equality filter on `eventId`, counted in memory. The emulator does not
 * enforce composite indexes, so anything cleverer would pass locally and fail
 * in production.
 */

export interface ImageSource {
  /** What the images are of. */
  label: string;
  /** The field they live on. */
  field: string;
  /** Records of this kind. */
  total: number;
  /** Records carrying an image. */
  withImage: number;
  /** Distinct hosts the images are served from, most common first. */
  hosts: { host: string; count: number }[];
  /** Where an organizer changes them today, if anywhere. */
  editedAt?: string;
  /** Why there is nowhere, when there is nowhere. Shown in place of the link. */
  editedNote?: string;
}

export interface ImageCensus {
  sources: ImageSource[];
  totalImages: number;
  /** Images served from a domain this project does not control. */
  offsite: number;
  /** Images uploaded through this product, rather than linked from elsewhere. */
  uploaded: number;
}

/** `https://example.com/a/b.jpg` → `example.com`. Never throws on rubbish. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    // A relative path or a typed-in string that is not a URL. Both happen, and
    // both are worth showing as themselves rather than dropped.
    return url.startsWith('/') ? 'this site' : 'not a URL';
  }
}

function tally(urls: (string | undefined)[]): { hosts: { host: string; count: number }[]; n: number } {
  const counts = new Map<string, number>();
  let n = 0;

  for (const url of urls) {
    if (!url) continue;
    n++;
    const host = hostOf(url);
    counts.set(host, (counts.get(host) ?? 0) + 1);
  }

  return {
    n,
    hosts: [...counts.entries()]
      .map(([host, count]) => ({ host, count }))
      .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host)),
  };
}

/**
 * Count every image in the database, by where it lives and who serves it.
 *
 * Never throws: these screens are diagnostics, and a diagnostic that cannot
 * render when something is wrong is a diagnostic that fails exactly when it is
 * needed.
 */
export async function imageCensus(): Promise<ImageCensus> {
  const sources: ImageSource[] = [];

  try {
    const [speakerSnap, sponsorSnap, userSnap, exhibitorSnap] = await Promise.all([
      db().collection(COLLECTIONS.speakers).where('eventId', '==', EVENT_ID).get(),
      db().collection(COLLECTIONS.sponsors).where('eventId', '==', EVENT_ID).get(),
      db().collection(COLLECTIONS.users).where('eventId', '==', EVENT_ID).get(),
      db().collection(COLLECTIONS.exhibitors).where('eventId', '==', EVENT_ID).get(),
    ]);

    const speakers = speakerSnap.docs.map((d) => (d.data() as SpeakerDoc).photoURL);
    const sponsors = sponsorSnap.docs.map((d) => (d.data() as SponsorDoc).logoURL);
    const users = userSnap.docs.map((d) => (d.data() as UserDoc).photoURL);
    const exhibitors = exhibitorSnap.docs.map((d) => (d.data() as ExhibitorDoc).logoURL);

    const s = tally(speakers);
    const p = tally(sponsors);
    const u = tally(users);
    const x = tally(exhibitors);

    sources.push(
      {
        label: 'Speaker headshots',
        field: 'speakers.photoURL',
        total: speakerSnap.size,
        withImage: s.n,
        hosts: s.hosts,
        // Speaker Manager uploads headshots as of 2026-08-31. It was read-only
        // for months, and this entry said so; a comment claiming there is
        // nowhere to edit an image is now the thing that would send someone
        // looking for a control they already have.
        editedAt: '/content/speaker-center/speaker-manager',
        editedNote: undefined,
      },
      {
        label: 'Sponsor logos',
        field: 'sponsors.logoURL',
        total: sponsorSnap.size,
        withImage: p.n,
        hosts: p.hosts,
        // Sponsor Manager uploads logos as of 2026-08-31, so its missing-logo
        // banner is now actionable on the screen that raises it.
        //
        // An earlier version of this comment warned that the website shadowed
        // an uploaded logo with a self-hosted file for eighteen whitelisted
        // slugs. That split was closed the same day: the whitelist became a
        // fallback that answers only when Firestore holds nothing, and the seed
        // stopped writing Whova's CDN into `logoURL`. An upload now wins on
        // every surface.
        editedAt: '/content/sponsor-center/sponsor-manager',
        editedNote: undefined,
      },
      {
        label: 'Attendee profile photos',
        field: 'users.photoURL',
        total: userSnap.size,
        withImage: u.n,
        hosts: u.hosts,
        // Not editable from the dashboard at all — the attendee sets it, and
        // today there is no way for them to set it either: the app has no image
        // picker, which needs a development build rather than Expo Go.
        editedAt: undefined,
        editedNote: 'nowhere — the attendee sets it, and cannot',
      },
      {
        label: 'Exhibitor logos',
        field: 'exhibitors.logoURL',
        total: exhibitorSnap.size,
        withImage: x.n,
        hosts: x.hosts,
        // The only one of the four that is true, and the reason this census is
        // worth keeping: it is the screen that proves the upload path works.
        editedAt: '/content/exhibitor-center/exhibitor-manager',
      },
    );
  } catch (err) {
    recordError('images.census', err);
  }

  const totalImages = sources.reduce((n, s) => n + s.withImage, 0);

  /**
   * "Uploaded here" is counted, not asserted.
   *
   * It was zero for as long as nothing in this project wrote to Storage, and it
   * was derived even then, precisely so it would become correct on its own the
   * day an upload path existed. That day was 2026-08-30 and the number moved
   * without this function being touched — which is the argument for measuring
   * rather than describing, in one line of evidence.
   */
  const uploaded = sources.reduce(
    (n, s) =>
      n +
      s.hosts
        .filter((h) => h.host.includes('firebasestorage') || h.host.includes('storage.googleapis'))
        .reduce((m, h) => m + h.count, 0),
    0,
  );

  return { sources, totalImages, offsite: totalImages - uploaded, uploaded };
}
