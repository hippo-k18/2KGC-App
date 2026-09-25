import Image from 'next/image';
import Link from 'next/link';
import { SITE } from '@/lib/site';

/**
 * Copyright runs from the first conference to the current edition — 2019 is
 * when KGC started and 2027 is what this site sells. It is written out rather
 * than computed from `new Date()`, which would make the footer a moving target
 * that invalidates the static render every year at midnight on 1 January.
 */
export function SiteFooter({
  contactEmail = SITE.contactEmail,
  datesShort = SITE.datesShort,
  venue = SITE.venue,
  showAgenda = false,
  showSpeakers = false,
}: {
  contactEmail?: string;
  /** From Content > Basics, resolved in the root layout. The defaults are the constants. */
  datesShort?: string;
  venue?: string;
  showAgenda?: boolean;
  showSpeakers?: boolean;
}) {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="cols">
          <div>
            <Image src="/kgc-mark.png" alt="" width={300} height={300} className="mark" />
            <p>
              The Knowledge Graph Conference brings together the people building the semantic layer
              underneath enterprise AI: practitioners, researchers and vendors.
            </p>
            {/*
              The only place on the site that renders the organizer's
              `settings/branding.supportEmail` — the root layout resolves it and
              passes it in, falling back to `SITE.contactEmail` when nobody has
              set one. The default keeps this component usable on its own and
              keeps an empty setting from producing `mailto:`.
            */}
            <p>
              <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
            </p>
          </div>

          <div>
            <h2>Attend</h2>
            <Link href="/tickets">Tickets</Link>
            {showAgenda && <Link href="/agenda">Agenda</Link>}
            {showSpeakers && <Link href="/speakers">Speakers</Link>}
            {/* An attendee-facing directory of who is in the hall, so it sits
                with the programme rather than under Participate with the
                packages that sell a booth. */}
            <Link href="/exhibitors">Exhibitors</Link>
            {/* The organizers' own broadcasts and the ungated handouts. Both
                read the collections the dashboard writes, so they belong beside
                the programme rather than under Participate — this column is the
                things an attendee looks up, not the things they buy. */}
            <Link href="/announcements">Announcements</Link>
            <Link href="/documents">Documents</Link>
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
            {/* Beside the code of conduct for the same reason: both are things
                people are told they have agreed to, and a privacy notice
                nobody can find is one nobody read. */}
            <Link href="/privacy">Privacy</Link>
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
            {datesShort} · {venue}
          </span>
          {/* The home page photograph is CC BY-SA 3.0, which requires this. */}
          <span className="photo-credit">
            Home page photo by{' '}
            <a
              href="https://commons.wikimedia.org/wiki/File:NYC_Empire_State_Building_view_NNE.jpg"
              target="_blank"
              rel="noreferrer"
            >
              Arnoldius
            </a>
            ,{' '}
            <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">
              CC BY-SA 3.0
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
