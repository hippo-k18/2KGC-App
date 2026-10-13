import Link from 'next/link';
import { groupSponsorsByTier } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listSponsors } from '@/lib/data';
import { sponsorTiers } from '@/lib/event';
import { ROUTES } from '@/lib/nav';
import { GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table } from '../../../ui';
import { TierEditor } from './tier-editor';

export const dynamic = 'force-dynamic';

/**
 * Content › Sponsor Center › Sponsor Tiering.
 *
 * The tier list is `settings/sponsorTiers`: an ordered array of
 * `{ id, name, size }`, edited here. `SponsorDoc.tier` stores an id from it.
 * Until somebody saves, the list is the four tiers the live site sells —
 * Platinum 3, Gold 2, Silver 1, Bronze 1 — which used to be a union in
 * `models.ts` and made "Diamond" a code change and an app release.
 *
 * Three surfaces follow this list and all three group with
 * `groupSponsorsByTier` from `@kgc/shared`: Sponsor Manager, the website's
 * sponsor bands, and the app's sponsor list. Order is rank, and `size` is the
 * logo size step on the public page.
 *
 * Moving a sponsor between tiers stays on the sponsor, in Sponsor Manager.
 */
export default async function SponsorTieringPage() {
  await requireOrganizer();

  const [sponsors, tiers] = await Promise.all([listSponsors(), sponsorTiers()]);
  const groups = groupSponsorsByTier(tiers, sponsors, { keepEmpty: true });
  const counts = Object.fromEntries(groups.map((g) => [g.tier.id, g.sponsors.length]));
  const strays = groups.filter((g) => !tiers.some((t) => t.id === g.tier.id));

  return (
    <>
      <PageHeader
        title="Sponsor Tiering"
        info={
          <>
            <strong>Tiers</strong>
            <p>
              Add, rename and reorder tiers. The website and the app group sponsors in this order.
              To move a sponsor between tiers, edit the sponsor.
            </p>
          </>
        }
        links={[
          <Link key="s" href={ROUTES.sponsorManager}>
            Sponsor Manager
          </Link>,
          <Link key="m" href={ROUTES.messageSponsors}>
            Message Sponsors
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Sponsors', value: sponsors.length, sub: `across ${tiers.length} tiers` },
          { label: 'Tiers', value: tiers.length, sub: `${tiers[0].name} to ${tiers[tiers.length - 1].name}` },
          {
            label: 'Missing a logo',
            value: sponsors.filter((s) => !s.hasLogo).length,
            sub: 'nothing to place',
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Tiers</h2>
        <TierEditor tiers={tiers} counts={counts} />
        <p className="muted" style={{ fontSize: 12, marginTop: 14, marginBottom: 0 }}>
          Logo size sets how large the logos in a tier are on the public sponsor page. A tier with
          sponsors in it cannot be removed.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Who is in each tier</h2>
        {sponsors.length === 0 ? (
          <NotInputted
            what="sponsors"
            action={
              <Link className="whova-btn-main primary" href={`${ROUTES.sponsorManager}?new=1`}>
                Add the first one
              </Link>
            }
          />
        ) : null}
        <Table
          cols={[
            { key: 't', label: 'Tier', className: 'cell-sm' },
            { key: 'n', label: 'Sponsors', className: 'cell-xsm' },
            { key: 'l', label: 'Who', className: 'cell-fill' },
          ]}
          rows={groups.map((g) => [
            <strong key="t">{g.tier.name}</strong>,
            <span key="n">{g.sponsors.length}</span>,
            <span key="l" style={{ fontSize: 12 }}>
              {g.sponsors.length === 0 ? (
                <span className="muted">nobody at this tier yet</span>
              ) : (
                g.sponsors.map((s) => s.name).join(', ')
              )}
            </span>,
          ])}
        />
        {strays.length > 0 ? (
          <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
            {strays.map((g) => g.tier.name).join(', ')}: not in the tier list. These sponsors show
            last. Edit them in <Link href={ROUTES.sponsorManager}>Sponsor Manager</Link> to pick a
            tier.
          </p>
        ) : null}
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Benefits per tier.</strong> Nothing models what a tier includes, so nothing can
            be checked off against a contract.
          </li>
          <li>
            <strong>Sponsor banners in the app,</strong> sponsored sessions and sponsored
            announcements.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
