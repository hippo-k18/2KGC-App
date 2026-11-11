import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { tierName } from '@kgc/shared';
import { listSponsors } from '@/lib/data';
import { sponsorTiers } from '@/lib/event';
import { publicUrl } from '@/lib/webpages';
import { ROUTES } from '@/lib/nav';
import { GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../../../ui';

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
  const [sponsors, tiers] = await Promise.all([listSponsors(), sponsorTiers()]);

  const withLogo = sponsors.filter((s) => s.hasLogo);
  /** The first two tiers in the saved order: Platinum and Gold until somebody changes them. */
  const top = tiers.slice(0, 2).map((t) => t.id);
  const topTiers = sponsors.filter((s) => top.includes(s.tier));
  const topMissing = topTiers.filter((s) => !s.hasLogo);

  return (
    <>
      <PageHeader
        title="Sponsor Banner"
        info={
          <>
            <strong>Artwork, not placement</strong>
            <p>
              These logos show on the public Sponsors page and on sponsor cards in the app&rsquo;s
              People tab. Rotating sponsor banners are not available yet.
            </p>
          </>
        }
        tags={
          topMissing.length === 0 ? (
            <Tag color="green" fill="outline">artwork complete</Tag>
          ) : (
            <Tag color="orange" fill="outline">{topMissing.length} without artwork</Tag>
          )
        }
        actions={
          <a href={publicUrl('/sponsor')} target="_blank" rel="noreferrer" className="whova-btn-main secondary">
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
            sub: 'top tiers with a logo',
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
            { key: 'w', label: 'Shown on', className: 'cell-md' },
          ]}
          rows={sponsors.map((s) => [
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
                {tierName(tiers, s.tier)}
              </Tag>,
              s.hasLogo ? (
                <span key="w" style={{ fontSize: 12 }}>
                  /sponsor and the People tab
                </span>
              ) : (
                <span key="w" className="muted" style={{ fontSize: 12 }}>
                  nowhere, no logo
                </span>
              ),
            ])}
          empty={
            <NotInputted
              what="sponsors"
              compact
              action={
                <Link className="btn btn-primary" href={ROUTES.sponsorManager}>
                  Add one in Sponsor Manager
                </Link>
              }
            />
          }
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
            <strong>Re-cropping artwork.</strong> Sponsor Manager uploads to Storage through{' '}
            <code>lib/uploads.ts</code> and the bucket exists, so a logo can be replaced from this
            dashboard — but nothing resizes or re-crops one, so a 4:1 wordmark stays a 4:1
            wordmark.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
