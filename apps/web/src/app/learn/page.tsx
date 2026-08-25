import type { Metadata } from 'next';
import Image from 'next/image';

export const metadata: Metadata = {
  title: 'Learn',
  description:
    'KGC | Learn — the team, the continuing education roster, and the four certificate programmes.',
};

/**
 * A close copy of the live knowledge-graph-learning-program page, measured on
 * 2026-08-19 at a 1600px viewport with `getComputedStyle`.
 *
 * Four bands. Their colours were sampled from **rendered pixels**, not read out
 * of the stylesheet, because the wave texture sits over each one and the
 * declared colour is not what you see — the continuing-education band computes
 * to `#8dccee` and renders `#e3f5fd`. Reading the CSS would have got that one
 * wrong by a long way.
 *
 *   hero            #e0e5ee + wave-13, wordmark at 1000px
 *   team            #ffffff + wave-3
 *   continuing ed   #e3f5fd + wave-3
 *   programmes      #8dccee
 *
 * The type is equally literal: 57/700 headings with an 800 span inside them,
 * 22/35 body, 20/700 founder names over 14/23 teal roles, and — a quirk worth
 * keeping — the roster's roles are Roboto 17/500 uppercase while every other
 * word on the page is Open Sans.
 *
 * The founder portraits are **square** at 191×191. They were circles here,
 * which was the single most visible difference from the original.
 */

const FOUNDERS = [
  {
    name: 'François Scharffe',
    role: 'Co-Founder',
    img: '/kgc/francois-scharffe.png',
    li: 'https://www.linkedin.com/in/francoischarffe/',
  },
  {
    name: 'Thomas Deely',
    role: 'Co-Founder',
    img: '/kgc/thomas-deely.png',
    li: 'https://www.linkedin.com/in/thomasdeely/',
  },
  {
    name: 'Maru Willson',
    role: 'Chief Learning Officer',
    img: '/kgc/maru-willson.jpeg',
    li: 'https://www.linkedin.com/in/maruwillson/',
  },
];

const ROSTER = [
  { name: 'Alex Shifrin', role: 'Subject Matter Lead' },
  { name: 'Casey Hart', role: 'Guest Instructor' },
  { name: 'Keith Corbett', role: 'Teaching Assistant' },
  { name: 'Anatoly Scherbakov', role: 'Teaching Assistant' },
  { name: 'Adam Shepherd', role: 'Teaching Assistant' },
  { name: 'Vinay Chaudhri', role: 'Guest Instructor' },
];

const PROGRAMS = [
  {
    name: 'Explorer Certificate',
    body: 'fully online for individuals without prior experience who learn at their own pace.',
  },
  {
    name: 'Builder Micro-Certificates',
    body: 'part-virtual and part-online for individuals with experience in data science and adjacent fields who benefit from a cohort structure.',
    parts: [
      'Builder MC-1 Bricks to Building KGs',
      'Builder MC-2 Build with Confidence',
      'Builder MC-3 Build with Nuance',
      'Builder MC-4 Build Something Real',
    ],
  },
  {
    name: 'Team Upskilling',
    body: 'for organizations introducing knowledge graphs and AI-readiness to teams of 5 or more.',
  },
  {
    name: 'Open Classroom',
    body: 'free access to our curated content without the structure and rigor of a certificate.',
  },
];

const BROCHURE = 'mailto:contact@knowledgegraph.tech?subject=KGC%20Learn%20brochure';

/** Font Awesome's `linkedin` glyph, the same one the live page inlines. */
function LinkedIn({ href, size = 20 }: { href?: string; size?: number }) {
  const svg = (
    <svg width={size} height={size} viewBox="0 0 448 512" fill="currentColor" aria-hidden="true">
      <path d="M100.28 448H7.4V148.9h92.88zM53.79 108.1C24.09 108.1 0 83.5 0 53.8a53.79 53.79 0 0 1 107.58 0c0 29.7-24.1 54.3-53.79 54.3zM447.9 448h-92.68V302.4c0-34.7-.7-79.2-48.29-79.2-48.29 0-55.69 37.7-55.69 76.7V448h-92.78V148.9h89.08v40.8h1.3c12.4-23.5 42.69-48.3 87.88-48.3 94 0 111.28 61.9 111.28 142.3V448z" />
    </svg>
  );
  if (!href) return <span className="li-icon">{svg}</span>;
  return (
    <a className="li-icon" href={href} target="_blank" rel="noreferrer" aria-label="LinkedIn profile">
      {svg}
    </a>
  );
}

export default function LearnPage() {
  return (
    <>
      <section className="learn-hero-band">
        <div className="wrap-kgc">
          <Image
            src="/kgc/learn-wordmark.png"
            alt="KGC | Learn"
            width={1000}
            height={275}
            priority
          />
          <p className="tagline">
            Learn how knowledge graphs can shape the future of your business and career.
          </p>
          <p className="strap">Where peer-learning drives practice.</p>
        </div>
      </section>

      <section className="learn-team-band">
        <div className="wrap-kgc">
          <h2 className="learn-h2">
            Meet the <b>KGC | Learn</b> Team
          </h2>
          <p className="learn-intro">
            KGC|Learn was established by KGC with a 2023 grant from the National Science Foundation
            to attract the best of the KGC Community and Conferences.
          </p>

          <div className="learn-people">
            {FOUNDERS.map((p) => (
              <div key={p.name} className="learn-person">
                <Image src={p.img} alt={p.name} width={300} height={300} />
                <div className="row">
                  <div>
                    <span className="name">{p.name}</span>
                    <p className="role">{p.role}</p>
                  </div>
                  <LinkedIn href={p.li} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="learn-ce-band">
        <div className="wrap-kgc">
          <h2 className="learn-h2">
            Meet the <b>KGC|Learn</b>
            <br />
            Continuing Education Team
          </h2>

          <div className="learn-roster">
            {ROSTER.map((p) => (
              <div key={p.name}>
                <span className="name">{p.name}</span>
                <span className="role">{p.role}</span>
                <LinkedIn />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="learn-programs-band">
        <div className="wrap-kgc">
          <h2 className="learn-h2">
            Find the program
            <br />
            that is right for you
          </h2>

          <div className="learn-programs">
            <p>
              Our program brings together open content from leading knowledge graph practitioners in
              a structured and guided environment for learners.
            </p>
            <p>
              We use evidence-based adult learning approaches to meet participants where they are in
              their knowledge graph learning journey.
            </p>

            <ul>
              {PROGRAMS.map((p) => (
                <li key={p.name}>
                  <strong>{p.name}</strong> {p.body}{' '}
                  <a href={BROCHURE}>Learn more and download the brochure.</a>
                  {p.parts && (
                    <ul>
                      {p.parts.map((part) => (
                        <li key={part}>{part}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}
