import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { publicUrl } from '@/lib/webpages';
import { Banner, GapPanel, PageHeader, Panel, Tag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Organizer Co-Promo.
 *
 * ── Not applicable, and that is a category rather than a gap ────────────────
 *
 * Whova's co-promo swaps promotional slots between events **inside Whova**: your
 * event appears to attendees of somebody else's event, and theirs appears to
 * yours. The feature is not software, it is the network — it works because
 * Whova has tens of thousands of events and one audience that moves between
 * them.
 *
 * We have one event, one app, one audience. There is no marketplace to be
 * promoted inside, so there is nothing here to build badly. Building a "co-promo"
 * screen that emailed other conferences would be a different product wearing this
 * one's name.
 *
 * The screen still exists because the nav does, and because an organizer
 * evaluating the move deserves "this does not apply and here is why" rather than
 * a 404 or a spinner. The distinction between *unbuilt* and *not applicable*
 * is the whole point of this page.
 */
export default async function OrganizerCoPromoPage() {
  await requireOrganizer();

  return (
    <>
      <PageHeader
        title="Organizer Co-Promo"
        tags={<Tag color="grey" fill="outline">not applicable</Tag>}
        actions={
          <a href={publicUrl('/')} target="_blank" rel="noreferrer" className="whova-btn-main">
            Open the site ↗
          </a>
        }
        links={[
          <Link key="w" href="/marketing/event-website">
            Event Website
          </Link>,
          <Link key="s" href="/tools/app-adoption/social-media">
            Social media copy
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>This one is not missing — it does not apply.</strong> Co-promo markets your event to
        the attendees of <em>other events on Whova</em>. That requires Whova&rsquo;s marketplace.
        There is no marketplace here, so there is no slot to trade and nothing to opt into.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Why this is not on the roadmap</h2>
        <p className="body-2">
          Every other unbuilt screen in this dashboard is a thing we could build and have not. This
          one is a thing we could only build by <em>becoming Whova</em> — signing up other
          conferences, running an ad exchange between them, and owning an audience that spans
          events. That is a marketplace business, not a feature of KGC&rsquo;s app.
        </p>
        <p className="body-2" style={{ marginBottom: 0 }}>
          Marking it &ldquo;coming soon&rdquo; would be the more comfortable answer and the less
          honest one. Reaching people who have not heard of KGC is a real need; it is served by the
          channels KGC already has — the mailing list, the speakers&rsquo; own networks, and the
          copy under <Link href="/tools/app-adoption/social-media">Social Media</Link>.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Cross-event promotion.</strong> No marketplace, no partner events, no exchange.
            Not planned, and not a gap in parity so much as a difference in what the product is.
          </li>
          <li>
            <strong>Promotional slots in the app.</strong> The app renders no ad surface of any
            kind — the same missing surfaces that block sponsor banners.
          </li>
          <li>
            <strong>Reach or impression reporting.</strong> Nothing to report on, and nothing
            measures traffic to the public site anyway.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
