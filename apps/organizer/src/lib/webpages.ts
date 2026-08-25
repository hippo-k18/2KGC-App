import 'server-only';

import { COLLECTIONS, EVENT_ID, type SessionDoc, type SpeakerDoc, type SponsorDoc } from '@kgc/shared';
import { db } from './firestore';

/**
 * Marketing › Event Webpages — what Whova's page builder is, for us.
 *
 * ── This is the one tab where we are ahead, and it needs saying ─────────────
 *
 * Whova's Event Webpages generate a hosted agenda, speaker and sponsor page
 * from event data, on a `whova.com` URL, with an embed snippet for your real
 * site. **We already have those pages** — `apps/web` renders `/agenda`,
 * `/speakers` and `/sponsor` from the same Firestore documents, at
 * knowledgegraph.tech, with the conference's own design.
 *
 * So these screens are not page builders. They are the honest thing a page
 * builder is for: showing an organizer what is published, whether the data
 * behind it is complete enough to publish, and giving them the link. Building a
 * WYSIWYG editor for pages that already exist and already look right would be
 * work spent making the product worse.
 *
 * ── Readiness, not settings ─────────────────────────────────────────────────
 *
 * The useful question about a public page is not "what colour is it" but "is it
 * embarrassing yet" — a speakers page with eleven missing headshots, an agenda
 * with four sessions in no room. That is computable from the data, and it is
 * what these screens compute.
 */

export interface PageReadiness {
  /** Whova's name for the page, so the nav and the screen agree. */
  title: string;
  /** The live URL on the conference's own domain. */
  path: string;
  published: number;
  total: number;
  /** Things that would look wrong to a visitor today, most important first. */
  problems: { label: string; count: number }[];
}

function origin(): string {
  return (process.env.WEB_PUBLIC_ORIGIN ?? 'https://www.knowledgegraph.tech').replace(/\/$/, '');
}

export function publicUrl(path: string): string {
  return `${origin()}${path}`;
}

/**
 * Readiness for the three public pages that render real data.
 *
 * One pass over each collection. Same rule as everywhere else in this app: a
 * single equality filter on `eventId` and sorting in memory, because the
 * emulator does not enforce composite indexes and a `where` + `orderBy` would
 * pass locally and fail in production with `failed-precondition`.
 */
export async function pageReadiness(): Promise<{
  agenda: PageReadiness;
  speakers: PageReadiness;
  sponsors: PageReadiness;
}> {
  const [sessionSnap, speakerSnap, sponsorSnap] = await Promise.all([
    db().collection(COLLECTIONS.sessions).where('eventId', '==', EVENT_ID).get(),
    db().collection(COLLECTIONS.speakers).where('eventId', '==', EVENT_ID).get(),
    db().collection(COLLECTIONS.sponsors).where('eventId', '==', EVENT_ID).get(),
  ]);

  const sessions = sessionSnap.docs
    .map((d) => d.data() as SessionDoc)
    .filter((s) => !s.deletedAt && s.status !== 'cancelled');
  const speakers = speakerSnap.docs.map((d) => d.data() as SpeakerDoc);
  const sponsors = sponsorSnap.docs.map((d) => d.data() as SponsorDoc);

  const published = sessions.filter((s) => s.status === 'published');

  const nonEmpty = (label: string, count: number) => (count > 0 ? [{ label, count }] : []);

  return {
    agenda: {
      title: 'Agenda',
      path: '/agenda',
      published: published.length,
      total: sessions.length,
      problems: [
        ...nonEmpty('published with no room', published.filter((s) => !s.roomId).length),
        ...nonEmpty(
          'published with no speaker',
          published.filter((s) => (s.speakerIds ?? []).length === 0 && s.format !== 'social').length,
        ),
        ...nonEmpty('published with no description', published.filter((s) => !s.description).length),
        ...nonEmpty('still draft', sessions.filter((s) => s.status === 'draft').length),
      ],
    },
    speakers: {
      title: 'Speakers',
      path: '/speakers',
      published: speakers.length,
      total: speakers.length,
      problems: [
        // Headshots first: a speaker grid with holes is the single most visible
        // form of "this conference is not ready" on a public site.
        ...nonEmpty('no photo', speakers.filter((s) => !s.photoURL).length),
        ...nonEmpty('no bio', speakers.filter((s) => !s.bio).length),
        ...nonEmpty('no company', speakers.filter((s) => !s.company).length),
        ...nonEmpty('not on any session', speakers.filter((s) => (s.sessionIds ?? []).length === 0).length),
      ],
    },
    sponsors: {
      title: 'Sponsors',
      path: '/sponsor',
      published: sponsors.length,
      total: sponsors.length,
      problems: [
        ...nonEmpty('no logo', sponsors.filter((s) => !s.logoURL).length),
        ...nonEmpty('no website link', sponsors.filter((s) => !s.website).length),
        ...nonEmpty('no booth assigned', sponsors.filter((s) => !s.boothLocation).length),
        ...nonEmpty('no main contact', sponsors.filter((s) => !s.contactEmail).length),
      ],
    },
  };
}
