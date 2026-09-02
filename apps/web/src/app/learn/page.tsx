import type { Metadata } from 'next';
import Image from 'next/image';
import { LinkedIn } from '@/components/linkedin-icon';
import { LEARN_FOUNDERS } from '@/lib/people';

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
 *
 * ⚠️ The three founders are **not** declared here. They are three of the eight
 * people on `/team`, and while both pages declared them this site served two
 * different photographs of François Scharffe under the same job title. See
 * `lib/people.ts`.
 */

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
            {LEARN_FOUNDERS.map((p) => (
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
