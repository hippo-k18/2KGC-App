import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'About KGC',
  description:
    'How the Knowledge Graph Conference started at Columbia University in 2019, what it connects, and what it is for.',
};

/**
 * A close copy of the live /about-kgc page, measured on 2026-08-19 at a 1440px
 * viewport with `getComputedStyle` rather than eyeballed from a screenshot.
 *
 * Five bands, in this order and at these colours — hero `#263759` over the wave
 * texture, Origins `#e0e5ee`, Connecting `#ffffff` over the second wave,
 * Developments `#8dccee`, Mission `#e0e5ee`. Two of those are nested pairs on
 * the live page where only the inner colour is visible, so they were sampled
 * from the rendered pixels, not read out of the stylesheet.
 *
 * The type is equally literal: 70/700 hero, 62/800 section heads, 22/400 body
 * on a 35px line, a 42/800 and a 32/800 for the two split sections, and the
 * mission paragraph set in Roboto at 26/42 while everything around it is Open
 * Sans. Those are the live theme's computed values, quirks included.
 *
 * The copy is the live site's own, with two typos it carries left corrected
 * ("and and", "suchs as") and the year re-pointed at this event.
 */
export default function AboutPage() {
  return (
    <>
      <section className="about-hero">
        <div className="wrap-kgc">
          <h1>{SITE.name}</h1>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
            <a
              className="btn btn-accent btn-kgc"
              href="https://www.youtube.com/@knowledgegraphconference"
              target="_blank"
              rel="noreferrer"
            >
              KGC YouTube Channel
            </a>
            <Link className="btn btn-accent btn-kgc" href="/tickets">
              Register for KGC {SITE.year}
            </Link>
          </div>
        </div>
      </section>

      <section className="about-origins">
        <div className="wrap-kgc about-prose">
          <h2 className="kgc-h2-xl">KGC’s Origins</h2>
          <p>
            The Knowledge Graph Conference was founded at Columbia University in 2019 through a
            collaboration between François Scharffe, a faculty member in Applied Analytics, and
            Thomas Deely, Executive Director for Industry Partnerships.
          </p>
          <p>
            François Scharffe has been working in the field of knowledge graphs for over 20 years to
            date. He started working on the knowledge graph of the French dictionary in 2002.
            Throughout that time he has seen the evolution of the KG from an academic field, with a
            number of different names used to describe it, such as “semantic web” and “linked data”.
            Over the years, he had seen an increase in industry adoption.
          </p>
          <p>
            During the attendance of the International Semantic Web Conference (
            <a href="https://iswc2026.semanticweb.org/" target="_blank" rel="noreferrer">
              ISWC
            </a>
            ) in Monterey, California, the idea came to take knowledge graphs out of academia. He had
            seen that KGs had become mature and used in industry as a major technology component of
            robust data infrastructure. Loving the topic of knowledge graphs, he wanted to support it
            by building a community.
          </p>
          <p>
            Thomas Deely has an extensive background in applied and emerging tech, a passion for
            building and developing communities and expertise in building executive partnerships.
            While at Columbia University, Thomas saw an emerging need for a new type of education
            format, focused on peer learning, hands-on experiences, applied learning, and building
            communities of experts.
          </p>
          <p>
            With the increasing growth in the amount of data created and the growing importance of
            applied analytics, the concept of a conference on knowledge graphs presented an
            opportunity to test this vision. Thomas secured the funding for the initial launch of the
            Knowledge Graph Conference, and he has built out the partnership ecosystem and the
            community around the conference since 2019.
          </p>
          <p>
            The Knowledge Graph Conference is the direct result of their backgrounds and efforts over
            the last few years.
          </p>
          <p style={{ marginBottom: 0 }}>
            The Knowledge Graph Conference is emerging as the premier source of learning around
            knowledge graph technologies. We believe knowledge graphs are an underutilized yet
            essential force for solving complex societal challenges like climate change,
            democratizing access to knowledge and opportunity, and capturing business value made
            possible by advances in AI.
          </p>
        </div>
      </section>

      <section className="about-connecting">
        <div className="wrap-kgc about-split about-prose">
          <h2 className="kgc-h2-md">Connecting the Knowledge Ecosystem</h2>
          <div>
            <p>
              We bring together leaders across industry sectors to cover the latest in innovation and
              adoption of knowledge technologies in finance, healthcare, drug discovery, privacy,
              cyber, media, education, supply chain, inventory management, e-commerce, personal
              knowledge graphs, visualization, recommender systems, law firms, real estate, and much
              more. We have organized hundreds of workshops, tutorials, presentations, keynotes,
              panel discussions, and demonstrations of knowledge technologies.
            </p>
            <p>
              As a result of our efforts, KGC has seen an exponential growth in the quantity of our
              programming and attendance. Year after year since KGC’s inception in 2019, we have
              doubled our attendance and programming. In 2021, we had 4 full days of programming
              across 4 parallel program tracks with an attendance of over 1000+ global graph
              enthusiasts.
            </p>
            <p style={{ marginBottom: 0 }}>
              Throughout the last 3 years we have partnered and collaborated with more than 20+
              organizations throughout the development of the conference such as Accenture, AWS, the
              UN, Oracle, OriginTrail, Tigergraph, Datastax, Cambridge Semantics, and many more to
              share the applications of knowledge graphs in the world.
            </p>
          </div>
        </div>
      </section>

      <section className="about-developments">
        <div className="wrap-kgc about-split about-prose">
          <h2 className="kgc-h2-sm">KGC Developments</h2>
          <div>
            <p>Since 2019 we have:</p>
            <ul>
              <li>
                Launched an annual startup pitch event that focuses on matching startups building
                knowledge graphs within their tech stack with investors.
              </li>
              <li>
                Partnered with and aided the launch of the Enterprise Knowledge Graph Foundation
                (EKGF), which was established to define best practice and mature the marketplace for
                EKG adoption.
              </li>
              <li>
                Launched and developed a thriving, global community with over 2200+ members in 2020
                alongside our virtual conference. Boasting many dedicated channels such as our job
                board, working groups, study groups, an academic group, as well as an expert driven /
                open forum Q&amp;A platform.
              </li>
              <li style={{ marginBottom: 0 }}>
                Curated our rich and diverse content in a comprehensive video library that holds free
                and paid content collected throughout the developments of our conferences and
                community events.
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="about-mission">
        <div className="wrap-kgc">
          <h2 className="kgc-h2-xl">KGC’s Mission</h2>
          <p className="mission-copy">
            Our mission is to become a leading source of learning around knowledge graphs. To spread
            the awareness and use of knowledge technologies as a force for social good, through its
            ability to democratize access to knowledge and opportunity.
          </p>
          <Link className="btn btn-accent btn-kgc" href="/tickets">
            Register for KGC {SITE.year}
          </Link>
        </div>
      </section>
    </>
  );
}
