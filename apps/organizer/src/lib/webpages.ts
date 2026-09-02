import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  SPEAKERS_PAGE_SOURCE,
  servableLogoURL,
  publicSiteOrigin,
  type SessionDoc,
  type SpeakerDoc,
  type SponsorDoc,
} from '@kgc/shared';
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
  /**
   * Something true about the page that is not a defect.
   *
   * Separate from `problems` because that list is rendered as a list of things
   * to fix; a fact filed there reads as a fault.
   */
  note?: string;
}

/*
 * The origin was declared here with its own hardcoded default — the same defect
 * the note below records for `SPEAKERS_PAGE_SOURCE`, and it had already bitten:
 * seven other call sites defaulted to `localhost:3200` while this one defaulted
 * to production, so this screen and Campaign Link Tracking disagreed about
 * which host the event lives on. It comes from `@kgc/shared` now.
 */
const origin = publicSiteOrigin;

/*
 * `SPEAKERS_PAGE_SOURCE` was declared here too — a hand-kept second copy of the
 * one in `apps/web/src/lib/site.ts`, on the stated grounds that the two apps
 * are separate installs and neither may import the other.
 *
 * Neither half of that was true. Both apps depend on `@kgc/shared`, and the
 * duplication was doing active harm: whenever the two copies disagreed, this
 * screen counted speakers with no headshot and reported them as problems with a
 * page that rendered none of those records — arithmetically right, and telling
 * an organizer to go and fix something invisible.
 *
 * It is imported from `@kgc/shared` above now. One declaration, so the two
 * sides cannot disagree.
 */
export function publicUrl(path: string): string {
  return `${origin()}${path}`;
}

/**
 * Whova's own asset CDN, and the eighteen sponsor logos this repo ships.
 *
 * ── The CDN rule is shared; the slug set is not ─────────────────────────────
 *
 * `servableLogoURL()` in `@kgc/shared` is the single copy of the rule that a
 * URL on Whova's CDN does not count as a logo, because the public page drops it
 * rather than hotlink the product this one replaces. Both websites and the app
 * read it. This file used to carry a third copy of that regex.
 *
 * The slug set below is still local, and that is a smaller problem than it
 * looks: it lists files committed to `apps/web/public/kgc/sponsors/`, so it is
 * a fact about that directory rather than a rule, and the honest fix is reading
 * the directory rather than moving the list. Whoever adds a sponsor logo still
 * has to add the slug in two places until then.
 *
 * The alternative — counting `!logoURL`, which is what this screen did —
 * reported eighteen missing logos on a page that renders all eighteen, because
 * the public page falls back to `public/kgc/sponsors/{slug}.png` when Firestore
 * holds nothing. There is no way to debug that from the dashboard: the count
 * names companies whose logos are visibly on the page.
 */
const SELF_HOSTED_SPONSOR_LOGOS: ReadonlySet<string> = new Set([
  'abbvie',
  'accenture',
  'amazon-web-services',
  'bloomberg',
  'cloudera',
  'datahub',
  'fluree',
  'gdotv',
  'graphwise',
  'metaphacts',
  'neo4j',
  'oracle',
  'oxford-semantic-technologies',
  'process-tempo',
  'progress-software',
  'senzing',
  'stardog',
  'topquadrant',
]);

/** `Oxford Semantic Technologies` -> `oxford-semantic-technologies`. */
function logoSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Whether `/sponsor` prints a logo for this company, or falls back to its name.
 *
 * A URL on Whova's CDN is dropped before it is considered, exactly as the
 * public page drops it rather than hotlink the product this one replaces, so a
 * sponsor holding one counts as having no logo — which is what a visitor sees.
 */
export function sponsorLogoRenders(name: string, logoURL?: string): boolean {
  if (servableLogoURL(logoURL)) return true;
  return SELF_HOSTED_SPONSOR_LOGOS.has(logoSlug(name));
}

/**
 * The same question for an exhibitor, and the answer is narrower on purpose:
 * `SELF_HOSTED_EXHIBITOR_LOGOS` in `apps/web/src/lib/data.ts` is deliberately
 * empty — no exhibitor logo is committed to this repo — so an exhibitor has a
 * logo on the public page only if their own `logoURL` survives the CDN guard.
 */
export function exhibitorLogoRenders(logoURL?: string): boolean {
  return Boolean(servableLogoURL(logoURL));
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
      /*
       * Zero while the page renders the checked-in 2026 roster, because none of
       * these records reaches it. That zero is a statement about the page, not
       * a measurement of the collection, so nothing may divide by it — see
       * `webpage-screen.tsx`, which reads a page carrying a `note` as having no
       * completeness share at all rather than as 0% complete.
       *
       * The branch is inert today: `SPEAKERS_PAGE_SOURCE` is `'firestore'`, and
       * moving it to `@kgc/shared` is what stops the two sides disagreeing. It
       * stays because `'2026-roster'` is a working fallback rather than a
       * retired value, and the day somebody flips it back this screen has to
       * stop claiming these records are on the public page.
       */
      published: SPEAKERS_PAGE_SOURCE === 'firestore' ? speakers.length : 0,
      total: speakers.length,
      note:
        SPEAKERS_PAGE_SOURCE === 'firestore'
          ? undefined
          : '/speakers currently shows the published KGC 2026 roster, not this collection. These records do not appear on it.',
      /*
       * Only the fields the page prints. `SpeakerCard` in
       * `apps/web/src/components/speaker-grid.tsx` renders a portrait, the name,
       * the company and the job title and stops there; `bio` and `sessionIds`
       * were counted here and are invisible to every visitor. The app's speaker
       * profile does show a bio, which is why the field exists — but this screen
       * answers "would a visitor notice", and an incomplete bio is Speaker
       * Manager's problem, not this page's.
       */
      problems:
        SPEAKERS_PAGE_SOURCE === 'firestore'
          ? [
              // Headshots first: a speaker grid with holes is the single most visible
              // form of "this conference is not ready" on a public site.
              ...nonEmpty('no photo', speakers.filter((s) => !s.photoURL).length),
              ...nonEmpty('no company', speakers.filter((s) => !s.company).length),
              ...nonEmpty('no job title', speakers.filter((s) => !s.title).length),
            ]
          : [],
    },
    sponsors: {
      title: 'Sponsors',
      path: '/sponsor',
      published: sponsors.length,
      total: sponsors.length,
      /*
       * The two things `/sponsor` prints, and nothing else. `SponsorCard` in
       * `apps/web/src/lib/data.ts` carries name, tier, website and logo, and
       * `sponsor-tiers.tsx` renders the logo — or the company's name in its
       * place — inside a link to the website. `boothLocation` and
       * `contactEmail` were counted here too, so three of the four problems
       * this screen reported were about fields no visitor can see, and the
       * booth was not even the field the floor plan reads: `booths` is the
       * truth about a space, and sponsors are not in the hall at all.
       */
      problems: [
        ...nonEmpty(
          'no logo',
          sponsors.filter((s) => !sponsorLogoRenders(s.name, s.logoURL)).length,
        ),
        ...nonEmpty('no website link', sponsors.filter((s) => !s.website).length),
      ],
    },
  };
}
