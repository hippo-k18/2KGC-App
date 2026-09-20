import Link from 'next/link';
import type { SponsorTier } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listSponsors, TIER_ORDER } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Sponsor Center › Sponsor Tiering.
 *
 * ── The trade this screen is honest about ───────────────────────────────────
 *
 * `SponsorTier` in `packages/shared/src/models.ts` is a four-value union —
 * platinum, gold, silver, bronze — taken from the live site's own sponsor design
 * payload, not invented. That union is also the sort order, which is why nothing
 * needs a ranking table beyond `TIER_ORDER`.
 *
 * The consequence is direct and worth stating rather than burying: **adding a
 * tier is a code change and a deploy.** Not a row somebody types on a Tuesday —
 * an edit to a shared package, a typecheck across three consumers, and a release
 * of the mobile app if the new tier is to render on a phone.
 *
 * For one conference a year that is the cheaper trade. A tiers collection is a
 * document shape, an editor, an ordering field, a migration for existing
 * sponsors and a fallback for a tier deleted while sponsors still point at it —
 * several days of work to save an afternoon that happens once. But it *is* a
 * trade, and it is the wrong one the moment this dashboard runs a second event
 * with a different sponsorship deck. Sales invents a "Diamond" tier far more
 * often than engineering expects.
 */
export default async function SponsorTieringPage() {
  await requireOrganizer();

  const sponsors = await listSponsors();

  const byTier = TIER_ORDER.map((tier: SponsorTier) => ({
    tier,
    rows: sponsors.filter((s) => s.tier === tier),
  }));

  /**
   * The size weight per tier — Platinum 3, Gold 2, Silver 1, Bronze 1 — which is
   * how a sponsor widget decides logo sizes. Recorded here because it is the
   * actual placement rule, and it is the piece that has no surface to apply to
   * yet.
   */
  const WEIGHT: Record<SponsorTier, number> = { platinum: 3, gold: 2, silver: 1, bronze: 1 };

  return (
    <>
      <PageHeader
        title="Sponsor Tiering"
        info={
          <>
            <strong>Four fixed tiers</strong>
            <p>
              Tiers cannot be renamed or added here yet. To move a sponsor between tiers, edit the
              sponsor.
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
          { label: 'Sponsors', value: sponsors.length, sub: 'across four tiers' },
          { label: 'Tiers', value: TIER_ORDER.length, sub: 'Platinum to Bronze' },
          {
            label: 'Missing a logo',
            value: sponsors.filter((s) => !s.hasLogo).length,
            sub: 'nothing to place',
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Tiers as they stand</h2>
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
        {/*
          Read-only here by design rather than by necessity: a tier is a property
          of a sponsor, not a record of its own, so it is assigned on the sponsor
          — the select on Sponsor Manager's form — and this screen shows the
          shape that produces. There is nothing on this page a form could edit.
        */}
        <Table
          cols={[
            { key: 't', label: 'Tier', className: 'cell-sm' },
            { key: 'n', label: 'Sponsors', className: 'cell-xs' },
            { key: 'w', label: 'Logo weight', className: 'cell-sm' },
            { key: 'l', label: 'Who', className: 'cell-fill' },
          ]}
          rows={byTier.map((g) => [
            <strong key="t" style={{ textTransform: 'capitalize' }}>
              {g.tier}
            </strong>,
            <span key="n">{g.rows.length}</span>,
            <span key="w" className="muted">
              ×{WEIGHT[g.tier]}
            </span>,
            <span key="l" style={{ fontSize: 12 }}>
              {g.rows.length === 0 ? (
                <span className="muted">nobody at this tier yet</span>
              ) : (
                g.rows.map((s) => s.name).join(', ')
              )}
            </span>,
          ])}
        />
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          Logo weight sets logo size on the public sponsor page. To move a sponsor between tiers,
          edit them in <Link href={ROUTES.sponsorManager}>Sponsor Manager</Link>.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Where a tier decides placement</h2>
        <p className="body-2">
          The <Link href="/content/sponsor-center/advanced-banners">public sponsor page</Link>{' '}
          groups sponsors by tier and applies the weights above. Sponsor banners in the app,
          sponsored sessions and sponsored announcements are not available yet.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Editing tiers.</strong> Add, rename, reorder or delete — all four are edits to{' '}
            <code>packages/shared/src/models.ts</code>.
          </li>
          <li>
            <strong>Benefits per tier.</strong> Nothing models what a tier includes, so nothing can
            be checked off against a contract.
          </li>
          <li>
            <strong>Placement rules.</strong> The weights above are printed, not applied.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
