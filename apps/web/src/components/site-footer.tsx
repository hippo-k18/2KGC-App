import Image from 'next/image';
import { SiteLink } from './site-link';
import { SITE, homeVenue } from '@/lib/site';
import { INVOICE_PUBLIC } from '@/lib/invoice-public';

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
  mainOrigin,
  blogOrigin,
  termsPublished = false,
}: {
  /** Show the Terms link. Off until the terms are approved; see `lib/terms-core.ts`. */
  termsPublished?: boolean;
  contactEmail?: string;
  /** From Content > Basics, resolved in the root layout. The defaults are the constants. */
  datesShort?: string;
  venue?: string;
  showAgenda?: boolean;
  showSpeakers?: boolean;
  /** `mainSiteOrigin()` and `BLOG_ORIGIN`: on the blog host the links are absolute. */
  mainOrigin?: string;
  blogOrigin?: string;
}) {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="cols">
          <div>
            <Image
              src="/kgc-mark.png"
              alt="Knowledge Graph Conference"
              width={300}
              height={300}
              className="mark"
            />
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
            <SiteLink href="/tickets" mainOrigin={mainOrigin} blogOrigin={blogOrigin}>Tickets</SiteLink>
            {INVOICE_PUBLIC && <SiteLink href="/tickets/invoice" mainOrigin={mainOrigin} blogOrigin={blogOrigin}>Pay by invoice</SiteLink>}
            {showAgenda && <SiteLink href="/agenda" mainOrigin={mainOrigin} blogOrigin={blogOrigin}>Agenda</SiteLink>}
            {showSpeakers && <SiteLink href="/speakers" mainOrigin={mainOrigin} blogOrigin={blogOrigin}>Speakers</SiteLink>}
            {/* An attendee-facing directory of who is in the hall, so it sits
                with the programme rather than under Participate with the
                packages that sell a booth. */}
            <SiteLink href="/exhibitors" mainOrigin={mainOrigin} blogOrigin={blogOrigin}>Exhibitors</SiteLink>
            {/* The organizers' own broadcasts and the ungated handouts. Both
                read the collections the dashboard writes, so they belong beside
                the programme rather than under Participate — this column is the
                things an attendee looks up, not the things they buy. */}
            <SiteLink href="/announcements" mainOrigin={mainOrigin} blogOrigin={blogOrigin}>Announcements</SiteLink>
            <SiteLink href="/documents" mainOrigin={mainOrigin} blogOrigin={blogOrigin}>Documents</SiteLink>
            <SiteLink href="/past-speakers" mainOrigin={mainOrigin} blogOrigin={blogOrigin}>Past speakers</SiteLink>
          </div>

          <div>
            <h2>Participate</h2>
            <SiteLink href="/sponsor" mainOrigin={mainOrigin} blogOrigin={blogOrigin}>Sponsor KGC</SiteLink>
            <SiteLink href="/sponsor#speak" mainOrigin={mainOrigin} blogOrigin={blogOrigin}>Speak at KGC</SiteLink>
            <SiteLink href="/call-for-posters" mainOrigin={mainOrigin} blogOrigin={blogOrigin}>Poster track</SiteLink>
            <SiteLink href="/startup-pitch" mainOrigin={mainOrigin} blogOrigin={blogOrigin}>Startup pitch</SiteLink>
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
          {/*
            The policies people are told they have agreed to, in the legal row
            beside the copyright where sites usually keep them. They sat in the
            Participate column until the team asked for somewhere quieter
            (2026-09-28).
          */}
          <span className="legal">
            <SiteLink href="/privacy" mainOrigin={mainOrigin} blogOrigin={blogOrigin}>Privacy</SiteLink>
            <SiteLink href="/code-of-conduct" mainOrigin={mainOrigin} blogOrigin={blogOrigin}>Code of conduct</SiteLink>
            {termsPublished && (
              <SiteLink href="/terms" mainOrigin={mainOrigin} blogOrigin={blogOrigin}>Terms</SiteLink>
            )}
          </span>
          <span>
            {datesShort} ·{' '}
            {homeVenue(venue) === venue ? (
              venue
            ) : (
              /*
                Both forms, one shown. The home page says "Bryant Park"; every
                other page keeps the full name. `site.ts` says why CSS picks.
              */
              <>
                <span className="venue-full">{venue}</span>
                <span className="venue-home">{homeVenue(venue)}</span>
              </>
            )}
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
