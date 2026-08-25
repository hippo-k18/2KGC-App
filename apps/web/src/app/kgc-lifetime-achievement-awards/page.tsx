import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Lifetime Achievement Award',
  description:
    'The Knowledge Graph Conference Lifetime Achievement Award, and the people who have received it.',
};

/**
 * Built 2026-08-20 against the live /kgc-lifetime-achievement-awards page.
 *
 * The recipient list is the live page's own. It is deliberately short: the live
 * page names the 2026 recipients and one past recipient, and inventing a fuller
 * roll would be fabricating an award record.
 */

const CURRENT = {
  year: 2026,
  names: ['James Hendler', 'Ora Lassila', 'Tim Berners-Lee'],
};

const PAST = [{ year: 2025, names: ['Mark Musen'] }];

export default function AwardsPage() {
  return (
    <>
      {/*
        `about-hero-plain`, not `about-hero`. This page borrowed /about's hero,
        which sets its `h1` to 70.4px — but the live awards page uses the theme's
        ordinary 32px/48 heading, so ours was more than twice the size. Only
        /about and /team carry the oversized hero on the live site.
      */}
      <section className="about-hero about-hero-plain">
        <div className="wrap-kgc">
          <h1>KGC Lifetime Achievement Awards</h1>
        </div>
      </section>

      <section className="band band-centred" style={{ padding: '84px 0 76px' }}>
        <div className="wrap-kgc about-prose" style={{ maxWidth: 900, margin: '0 auto' }}>
          <h2 style={{ marginBottom: 28 }}>
            The Knowledge Graph Conference Lifetime Achievement Award
          </h2>
          <p style={{ textAlign: 'center' }}>
            A primary goal of KGC is to increase awareness of the exciting world of knowledge graphs,
            semantic technologies and AI. One of the ways we do that is by highlighting the leading
            contributors to the field.
          </p>
        </div>
      </section>

      <section className="band band-sky band-centred">
        <div className="wrap-kgc">
          <h2 className="kgc-h2-sm" style={{ marginBottom: 34 }}>
            {CURRENT.year} recipients
          </h2>
          <div className="laureates">
            {CURRENT.names.map((n) => (
              <div key={n} className="laureate">
                {n}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band band-centred" style={{ padding: '76px 0 84px' }}>
        <div className="wrap-kgc">
          <h2 className="kgc-h2-sm" style={{ marginBottom: 26 }}>
            Past recipients
          </h2>
          {PAST.map((p) => (
            <p key={p.year} className="learn-intro" style={{ marginBottom: 14 }}>
              <strong>{p.year}:</strong> {p.names.join(', ')}
            </p>
          ))}

          <div style={{ marginTop: 40 }}>
            <Link className="btn btn-accent btn-kgc" href="/tickets">
              Join us in May
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
