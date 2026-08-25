import type { Metadata } from 'next';
import Image from 'next/image';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Meet the Team',
  description: 'The people who run the Knowledge Graph Conference.',
};

/**
 * Built 2026-08-20 against the live /team page, which had no counterpart here —
 * it was one of three entries in the About KGC menu that had nowhere to point.
 *
 * Names, roles and headshots are the live page's own, downloaded rather than
 * approximated. The live page is headed "Meet the 2025 Team"; this reads
 * "Meet the team" because the roster is current rather than dated.
 */

const TEAM = [
  { name: 'François Scharffe', role: 'Co-Founder', img: '/kgc/team/francois-scharffe.jpeg', li: 'https://www.linkedin.com/in/francoischarffe/' },
  { name: 'Thomas Deely', role: 'Co-Founder', img: '/kgc/team/thomas-deely.jpg', li: 'https://www.linkedin.com/in/thomasdeely/' },
  { name: 'Poya Osgouei', role: 'Sponsorships Lead', img: '/kgc/team/poya-osgouei.jpeg', li: 'https://www.linkedin.com/in/poyaosgouei/' },
  { name: 'Paige Barrett', role: 'Chief Marketing Officer', img: '/kgc/team/paige-barrett.jpeg', li: 'https://www.linkedin.com/in/paigebarrett/' },
  { name: 'Maru Willson', role: 'Chief Learning Officer', img: '/kgc/team/maru-willson.jpeg', li: 'https://www.linkedin.com/in/maruwillson/' },
  { name: 'Hugues (Hugo) Seureau', role: 'KnowHax Lead', img: '/kgc/team/hugues-seureau.jpeg', li: 'https://www.linkedin.com/in/huguesseureau/' },
  { name: 'Catalina Padilla', role: 'Graphic Designer', img: '/kgc/team/catalina-padilla.jpeg', li: 'https://www.linkedin.com/in/catalinapadilla/' },
  { name: 'Bryce Merkl Sasaki', role: 'Managing Editor', img: '/kgc/team/bryce-merkl-sasaki.jpg', li: 'https://www.linkedin.com/in/brycemerklsasaki/' },
];

function LinkedIn({ href }: { href: string }) {
  return (
    <a className="li-icon" href={href} target="_blank" rel="noreferrer" aria-label="LinkedIn profile">
      <svg width="20" height="20" viewBox="0 0 448 512" fill="currentColor" aria-hidden="true">
        <path d="M100.28 448H7.4V148.9h92.88zM53.79 108.1C24.09 108.1 0 83.5 0 53.8a53.79 53.79 0 0 1 107.58 0c0 29.7-24.1 54.3-53.79 54.3zM447.9 448h-92.68V302.4c0-34.7-.7-79.2-48.29-79.2-48.29 0-55.69 37.7-55.69 76.7V448h-92.78V148.9h89.08v40.8h1.3c12.4-23.5 42.69-48.3 87.88-48.3 94 0 111.28 61.9 111.28 142.3V448z" />
      </svg>
    </a>
  );
}

export default function TeamPage() {
  return (
    <>
      <section className="about-hero">
        <div className="wrap-kgc">
          <h1>{SITE.name} Team</h1>
        </div>
      </section>

      <section className="band band-centred" style={{ padding: '88px 0 96px' }}>
        <div className="wrap-kgc">
          {/*
            The theme's plain 28px/42 heading, not `.learn-h2`.
            `.learn-h2` is the learning programme's 57.2px display size; the live
            team page uses the ordinary section heading here, so ours was running
            at twice the size purely because it borrowed the other page's class.
          */}
          <h2>Meet the team</h2>
          <p className="learn-intro">
            The people who programme the conference, run the community, and keep the week on its
            feet.
          </p>

          <div className="team-grid">
            {TEAM.map((p) => (
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
    </>
  );
}
