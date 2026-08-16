import Image from 'next/image';
import Link from 'next/link';
import { SITE } from '@/lib/site';

/**
 * Copyright runs from the first conference to the current edition — 2019 is
 * when KGC started and 2027 is what this site sells. It is written out rather
 * than computed from `new Date()`, which would make the footer a moving target
 * that invalidates the static render every year at midnight on 1 January.
 */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="cols">
          <div>
            <Image src="/kgc-mark.png" alt="" width={300} height={300} className="mark" />
            <p>
              The Knowledge Graph Conference brings together the people building the semantic layer
              underneath enterprise AI — practitioners, researchers and the vendors they argue with.
            </p>
            <p>
              <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>
            </p>
          </div>

          <div>
            <h4>Attend</h4>
            <Link href="/tickets">Tickets</Link>
            <Link href="/agenda">Agenda</Link>
            <Link href="/speakers">Speakers</Link>
            <Link href="/about">Venue &amp; travel</Link>
          </div>

          <div>
            <h4>Participate</h4>
            <Link href="/sponsor">Sponsor KGC</Link>
            <Link href="/sponsor#speak">Speak at KGC</Link>
            <Link href="/about#code-of-conduct">Code of conduct</Link>
          </div>

          <div>
            <h4>Follow</h4>
            {SITE.social.map((s) => (
              <a key={s.label} href={s.href} rel="noreferrer noopener" target="_blank">
                {s.label}
              </a>
            ))}
            <a href="https://www.youtube.com/@knowledgegraphconference" rel="noreferrer noopener" target="_blank">
              Watch videos
            </a>
          </div>
        </div>

        <div className="fine">
          <span>© 2019–2027 Knowledge Graph Conference. All rights reserved.</span>
          <span>
            {SITE.datesShort} · {SITE.venue}
          </span>
        </div>
      </div>
    </footer>
  );
}
