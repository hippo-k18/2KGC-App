import type { Metadata } from 'next';
import Link from 'next/link';
import { SLACK_WORKSPACE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Community',
  description:
    'The KGC community — around ten thousand knowledge graph professionals on Slack, LinkedIn and the newsletter.',
};

/**
 * Built 2026-08-20 against the live /community page, which had no counterpart
 * here. Copy and channel list are the live page's own; the Twitter block it
 * still carries is folded into the same row rather than given its own band,
 * because that account has not posted since 2024.
 */

const CHANNELS = [
  {
    name: 'Slack',
    body: 'Ask knowledge graph and graph data science questions, get book recommendations, search for jobs and follow announcements.',
    cta: 'Join the Slack',
    /*
     * The same declaration the footer's Slack link reads. This page held the
     * URL as a literal while `site.ts` argued that nobody had it and left the
     * social row without a Slack entry — one site, two opposite conclusions
     * about one address. `SLACK_WORKSPACE`'s docblock records which way that
     * was resolved and why.
     */
    href: SLACK_WORKSPACE,
    featured: true,
  },
  {
    name: 'LinkedIn',
    body: 'Announcements, new speakers, sponsors and programmes as they are confirmed.',
    cta: 'Follow on LinkedIn',
    href: 'https://www.linkedin.com/company/knowledge-graph-conference/',
  },
  {
    name: 'Newsletter',
    body: 'A monthly note on what the community is building, and what is coming at the next conference.',
    cta: 'Subscribe',
    href: 'mailto:contact@knowledgegraph.tech?subject=Newsletter',
  },
];

const LIBRARIES = [
  {
    name: 'YouTube channel',
    body: 'Keynotes, panel discussions, workshops and tutorials from the conference, across every track — data architecture, graph data science, deep learning, decentralisation, NLP, ontologies and taxonomies, EU projects, open knowledge networks, business use cases and product graphs.',
    href: 'https://www.youtube.com/@knowledgegraphconference',
  },
  {
    name: 'Vimeo library',
    body: 'An on-demand library of talks, workshops and tutorials recorded at previous KGC events.',
    href: 'https://vimeo.com/knowledgegraphconference',
  },
];

export default function CommunityPage() {
  return (
    <>
      <section className="band band-centred" style={{ padding: '84px 0 70px' }}>
        <div className="wrap-kgc">
          <p className="eyebrow" style={{ textAlign: 'center' }}>
            The biggest knowledge graph community
          </p>
          {/*
            48px/800, measured — the live page title. `.kgc-h2-xl` is /about's
            61.6px display size, which this borrowed.
          */}
          <h1 className="community-title" style={{ marginBottom: 22 }}>
            The KGC Community
          </h1>
          <p className="learn-intro" style={{ marginBottom: 46 }}>
            Be a part of our community of around ten thousand knowledge graph professionals.
          </p>

          <div className="channels">
            {CHANNELS.map((c) => (
              <div key={c.name} className={`channel${c.featured ? ' featured' : ''}`}>
                <h2>{c.name}</h2>
                <p>{c.body}</p>
                <a className="btn btn-primary" href={c.href} target="_blank" rel="noreferrer">
                  {c.cta}
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band band-sky band-centred">
        <div className="wrap-kgc">
          <p className="learn-intro" style={{ marginBottom: 0 }}>
            Join our vast and ever-growing community of lead ontologists, professors, best-selling
            authors, founders, C-suite executives, principal scientists and investors.
          </p>
        </div>
      </section>

      <section className="band" style={{ padding: '84px 0 96px' }}>
        <div className="wrap-kgc">
          <h2 className="kgc-h2-md" style={{ marginBottom: 40 }}>
            Watch the talks
          </h2>
          <div className="channels">
            {LIBRARIES.map((l) => (
              <div key={l.name} className="channel">
                <h2>{l.name}</h2>
                <p>{l.body}</p>
                <a className="btn btn-outline" href={l.href} target="_blank" rel="noreferrer">
                  Open {l.name.split(' ')[0]}
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band band-pale band-centred">
        <div className="wrap-kgc">
          <h2 className="kgc-h2-md" style={{ marginBottom: 18 }}>
            Meet them in person
          </h2>
          <p className="learn-intro" style={{ marginBottom: 30 }}>
            The community spends one week a year in the same building.
          </p>
          <Link className="btn btn-accent btn-kgc" href="/tickets">
            Register now
          </Link>
        </div>
      </section>
    </>
  );
}
