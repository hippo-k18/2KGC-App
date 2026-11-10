/**
 * The organizers of the HCLS symposium, as listed on `/hcls` (T381), in the
 * order Thomas gave them (Google Chat, 2026-11-08).
 *
 * Every link was checked by hand before it went in. Two people have no checked
 * link yet, so they render as a name only rather than with a guessed profile:
 * a wrong LinkedIn page under somebody's name is worse than none. Fill in the
 * constant below and the card picks the link up.
 *
 * `affiliation` is left out where we do not know the current one. Tom
 * Plasterer's past-speaker entry says AstraZeneca, which is out of date.
 */

/** No checked link yet. Set to the profile URL once somebody has verified it. */
export const HELENA_DEUS_LINK: string | null = null;
/** No checked link or affiliation yet. Set both once they are verified. */
export const ANALEE_ETHERIDGE_LINK: string | null = null;
export const ANALEE_ETHERIDGE_AFFILIATION: string | null = null;

export interface HclsOrganizer {
  name: string;
  affiliation: string | null;
  link: string | null;
  /** A photo under `public/`, or null for the initials avatar. */
  photo: string | null;
}

export const HCLS_ORGANIZERS: readonly HclsOrganizer[] = [
  {
    name: 'Helena Deus',
    affiliation: 'Bristol Myers Squibb',
    link: HELENA_DEUS_LINK,
    photo: '/kgc/speakers/helena-deus.jpg',
  },
  {
    name: 'Tom Plasterer',
    affiliation: null,
    link: 'https://www.linkedin.com/in/tplasterer',
    photo: '/kgc/past-speakers/tom-plasterer.webp',
  },
  {
    name: 'Deborah McGuinness',
    affiliation: 'Rensselaer Polytechnic Institute',
    link: 'https://en.wikipedia.org/wiki/Deborah_McGuinness',
    photo: '/kgc/past-speakers/deborah-mcguinness.webp',
  },
  {
    name: 'Jamie McCusker',
    affiliation: 'Rensselaer Polytechnic Institute',
    link: 'https://www.linkedin.com/in/jpmccu',
    photo: '/kgc/past-speakers/jamie-p-mccusker.webp',
  },
  {
    name: 'Ted Slater',
    affiliation: 'EPAM Systems',
    link: 'https://www.linkedin.com/in/tedslater',
    photo: '/kgc/speakers/ted-slater.jpg',
  },
  {
    name: 'Analee Etheridge',
    affiliation: ANALEE_ETHERIDGE_AFFILIATION,
    link: ANALEE_ETHERIDGE_LINK,
    photo: null,
  },
];

/** What the link says: the site it goes to, so nobody clicks blind. */
export function linkLabel(href: string): string {
  const host = new URL(href).hostname.replace(/^www\./, '');
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 'LinkedIn';
  if (host.endsWith('wikipedia.org')) return 'Wikipedia';
  return 'Profile';
}

/**
 * The avatar letters, as the speaker cards make them. Not imported from
 * `components/speaker-grid.tsx`, which is a client module: a server page
 * calling a function from one gets a client reference, not the function.
 */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
