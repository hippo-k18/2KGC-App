/**
 * The people who run KGC, declared once.
 *
 * ── Why this is hardcoded, and why it was hardcoded twice ───────────────────
 *
 * There is no `team` collection in Firestore and there should not be one: eight
 * people who change once a year are not a database, and Speaker Manager is the
 * screen an organizer would look for one on. So a constant is right. Two
 * constants were not.
 *
 * `/team` and `/learn` each declared François Scharffe, Thomas Deely and Maru
 * Willson, with the same role and the same LinkedIn URL and *different image
 * paths* — `/kgc/team/francois-scharffe.jpeg` against
 * `/kgc/francois-scharffe.png`. That was not a mistake at the time: each page
 * was rebuilt against its own live counterpart and each downloaded the portrait
 * that page served. But the result was one site showing two different
 * photographs of the same person under the same job title, and a role change
 * that had to be made in two files to be true.
 *
 * ── Which portrait won ──────────────────────────────────────────────────────
 *
 * `public/kgc/team/`. It is the complete set — all eight, uniformly 200×200 —
 * where the `/learn` copies were three loose files at two different sizes, and
 * Maru's was byte-identical in both places anyway. The three orphans were
 * deleted rather than left for the next person to wonder about.
 *
 * `/learn` shows a subset of this list, in its own order, because the KGC|Learn
 * founders are three of the eight and not a separate roster.
 */
export interface Person {
  name: string;
  role: string;
  /** Square, under `public/kgc/team/`. */
  img: string;
  /** LinkedIn profile URL. */
  li: string;
}

export const TEAM: readonly Person[] = [
  {
    name: 'François Scharffe',
    role: 'Co-Founder',
    img: '/kgc/team/francois-scharffe.jpeg',
    li: 'https://www.linkedin.com/in/francoischarffe/',
  },
  {
    name: 'Thomas Deely',
    role: 'Co-Founder',
    img: '/kgc/team/thomas-deely.jpg',
    li: 'https://www.linkedin.com/in/thomasdeely/',
  },
  {
    name: 'Poya Osgouei',
    role: 'Sponsorships Lead',
    img: '/kgc/team/poya-osgouei.jpeg',
    li: 'https://www.linkedin.com/in/poyaosgouei/',
  },
  {
    name: 'Paige Barrett',
    role: 'Chief Marketing Officer',
    img: '/kgc/team/paige-barrett.jpeg',
    li: 'https://www.linkedin.com/in/paigebarrett/',
  },
  {
    name: 'Maru Willson',
    role: 'Chief Learning Officer',
    img: '/kgc/team/maru-willson.jpeg',
    li: 'https://www.linkedin.com/in/maruwillson/',
  },
  {
    name: 'Hugues (Hugo) Seureau',
    role: 'KnowHax Lead',
    img: '/kgc/team/hugues-seureau.jpeg',
    li: 'https://www.linkedin.com/in/huguesseureau/',
  },
  {
    name: 'Catalina Padilla',
    role: 'Graphic Designer',
    img: '/kgc/team/catalina-padilla.jpeg',
    li: 'https://www.linkedin.com/in/catalinapadilla/',
  },
  {
    name: 'Bryce Merkl Sasaki',
    role: 'Managing Editor',
    img: '/kgc/team/bryce-merkl-sasaki.jpg',
    li: 'https://www.linkedin.com/in/brycemerklsasaki/',
  },
];

/** Throws at import time on a typo, so a misspelt name cannot render a gap. */
function member(name: string): Person {
  const found = TEAM.find((p) => p.name === name);
  if (!found) throw new Error(`No KGC team member named "${name}" — TEAM and its subsets disagree.`);
  return found;
}

/** The three founders `/learn` introduces, in that page's own order. */
export const LEARN_FOUNDERS: readonly Person[] = [
  'François Scharffe',
  'Thomas Deely',
  'Maru Willson',
].map(member);
