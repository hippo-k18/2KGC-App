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
            <h2>Attend</h2>
            <Link href="/tickets">Tickets</Link>
            <Link href="/agenda">Agenda</Link>
            <Link href="/speakers">Speakers</Link>
            <Link href="/about">Venue &amp; travel</Link>
          </div>

          <div>
            <h2>Participate</h2>
            <Link href="/sponsor">Sponsor KGC</Link>
            <Link href="/sponsor#speak">Speak at KGC</Link>
            <Link href="/call-for-posters">Poster track</Link>
            <Link href="/startup-pitch">Startup pitch</Link>
            {/* `/code-of-conduct`, not `/about#code-of-conduct`. It is a policy
                people are asked to agree to, and the live site gives it a page
                of its own rather than a fragment on another one. */}
            <Link href="/code-of-conduct">Code of conduct</Link>
          </div>

          <div>
            <h2>Follow</h2>
            {SITE.social.map((s) => (
              <a key={s.label} href={s.href} rel="noreferrer noopener" target="_blank">
                {s.label}
              </a>
            ))}
          </div>
        </div>

        {/*
          The live footer's signature: the white KGC wordmark, centred, above the
          copyright line. Its whole footer is only that plus a row of social
          icons — no link columns at all.
          We keep the columns, because deleting the only route to the poster
          track, the startup pitch and the code of conduct would be trading real
          navigation for a resemblance. The wordmark is added because it is the
          one element that makes the live footer recognisable at a glance, and it
          is the same asset the live site serves.
        */}
        <div className="footer-mark">
          <Image
            src="/kgc/cropped-White-Wordmark-2.png"
            alt="Knowledge Graph Conference"
            width={220}
            height={73}
          />
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
