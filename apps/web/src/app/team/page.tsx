import type { Metadata } from 'next';
import Image from 'next/image';
import { LinkedIn } from '@/components/linkedin-icon';
import { TEAM } from '@/lib/people';
import { siteEvent } from '@/lib/data';

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
 *
 * The roster itself is in `lib/people.ts`, because `/learn` introduces three of
 * these eight and used to declare them a second time — with different
 * photographs of the same people.
 */

export default async function TeamPage() {
  const ev = await siteEvent();
  return (
    <>
      <section className="about-hero">
        <div className="wrap-kgc">
          <h1>{ev.name} Team</h1>
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
