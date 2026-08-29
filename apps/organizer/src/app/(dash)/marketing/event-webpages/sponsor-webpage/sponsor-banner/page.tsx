import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listSponsors, TIER_ORDER } from '@/lib/data';
import { publicUrl } from '@/lib/webpages';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Event Webpages › Sponsor Webpage › Sponsor Banner.
 *
 * Whova's banner feature places a sponsor image on the app's home, agenda and
 * profile screens on a rotation, and reports impressions per sponsor.
 *
 * ── The gap is the surfaces, not the images ─────────────────────────────────
 *
 * We have the logos — eighteen sponsors, most of them with a real image URL.
 * What we do not have is anywhere in the Expo app that renders a banner: no slot
 * on Home, none on the agenda list, none on a profile. So this screen reports on
 * the half that exists (which sponsors have artwork, and at what tier) and says
 * plainly that nothing displays it, rather than offering a placement control
 * that would write a setting nothing reads.
 *
 * A tier column rather than an upload form on purpose: banner placement is sold
 * by tier, so the question an organizer arrives with is "have my platinum
 * sponsors sent artwork", and that is answerable now.
 */
export default async function SponsorBannerPage() {
  await requireOrganizer();
  const sponsors = await listSponsors();

  const withLogo = sponsors.filter((s) => s.hasLogo);
  const topTiers = sponsors.filter((s) => s.tier === 'platinum' || s.tier === 'gold');
  const topMissing = topTiers.filter((s) => !s.hasLogo);

  return (
    <>
      <PageHeader
        title="Sponsor Banner"
        tags={
          topMissing.length === 0 ? (
            <Tag color="green" fill="outline">artwork complete</Tag>
          ) : (
            <Tag color="orange" fill="outline">{topMissing.length} without artwork</Tag>
          )
        }
        actions={
          <a href={publicUrl('/sponsor')} target="_blank" rel="noreferrer" className="whova-btn-main">
            View the live sponsor page ↗
          </a>
        }
        links={[
          <Link key="l" href="/marketing/event-webpages/sponsor-webpage/sponsor-list">
            Sponsor list webpage
          </Link>,
          <Link key="m" href={ROUTES.sponsorManager}>
            Sponsor Manager
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>The app has no banner slots.</strong> These logos render on the public sponsor page
        and on the sponsor cards in the app&rsquo;s People tab. Nothing rotates a banner on Home, the
        agenda or a profile, so there is no placement to configure and no impression to count.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Sponsors', value: sponsors.length, sub: 'all tiers' },
          {
            label: 'With artwork',
            value: withLogo.length,
            sub: withLogo.length === sponsors.length ? 'all of them' : `${sponsors.length - withLogo.length} missing`,
          },
          {
            label: 'Platinum & gold ready',
            value: `${topTiers.length - topMissing.length}/${topTiers.length}`,
            sub: 'the tiers that were sold placement',
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Artwork on file</h2>
        <Table
          cols={[
            { key: 'i', label: '', className: 'cell-sm' },
            { key: 'n', label: 'Sponsor', className: 'cell-fill' },
            { key: 't', label: 'Tier', className: 'cell-sm' },
            { key: 'w', label: 'Where it renders today', className: 'cell-md' },
          ]}
          rows={[...sponsors]
            .sort(
              (a, b) =>
                TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) ||
                a.name.localeCompare(b.name),
            )
            .map((s) => [
              // The image itself, because the thing an organizer is checking is
              // whether a wordmark got squeezed — a "yes" column cannot show that.
              s.logoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key="i"
                  src={s.logoURL}
                  alt=""
                  style={{ height: 24, maxWidth: 88, objectFit: 'contain' }}
                />
              ) : (
                <span key="i" className="muted" style={{ fontSize: 12 }}>
                  none
                </span>
              ),
              s.name,
              <Tag key="t" color="grey" fill="outline" small>
                {s.tier}
              </Tag>,
              s.hasLogo ? (
                <span key="w" style={{ fontSize: 12 }}>
                  /sponsor and the People tab
                </span>
              ) : (
                <span key="w" className="muted" style={{ fontSize: 12 }}>
                  nowhere — no image
                </span>
              ),
            ])}
          empty="No sponsors yet."
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Banner slots in the app.</strong> Home, the agenda list and the profile screen
            render no sponsor image. Adding them is the actual feature; everything else on this
            list depends on it existing first.
          </li>
          <li>
            <strong>Rotation and scheduling.</strong> There is no placement record to rotate, so
            there is nothing to weight by tier or to run for a date range.
          </li>
          <li>
            <strong>Impressions and taps.</strong> Whova reports both per sponsor. Nothing in the
            app records either, and a sponsor report that invented them would be worse than none.
          </li>
          <li>
            <strong>Uploading artwork here.</strong> <code>logoURL</code> is a link to an image
            hosted elsewhere; no screen in this dashboard uploads to Storage or resizes an image.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
