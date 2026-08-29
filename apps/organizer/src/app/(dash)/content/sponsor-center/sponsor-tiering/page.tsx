import Link from 'next/link';
import type { SponsorTier } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listSponsors, TIER_ORDER } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

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
   * Whova's public sponsor design payload carries a size weight per tier —
   * Platinum 3, Gold 2, Silver 1, Bronze 1 — which is how their widget decides
   * logo sizes. Recorded here because it is the actual placement rule, and it is
   * the piece that has no surface to apply to yet.
   */
  const WEIGHT: Record<SponsorTier, number> = { platinum: 3, gold: 2, silver: 1, bronze: 1 };

  return (
    <>
      <PageHeader
        title="Sponsor Tiering"
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
          { label: 'Tiers', value: TIER_ORDER.length, sub: 'fixed in models.ts' },
          {
            label: 'Missing a logo',
            value: sponsors.filter((s) => !s.hasLogo).length,
            sub: 'nothing to place',
          },
        ]}
      />

      <Banner kind="info">
        <strong>Tiers are a type, not a table.</strong> <code>SponsorTier</code> is a four-value
        union in <code>@kgc/shared</code>, so renaming one or adding a fifth is a code change and a
        deploy rather than an edit here. At one event a year that is the cheaper trade — but it is a
        trade, and the day sales sells a &ldquo;Diamond&rdquo; package is the day it stops paying.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Tiers as they stand</h2>
        {/*
          Read-only by necessity, not by preference: a tier is assigned on the
          sponsor record, and Sponsor Manager is read-only too because sponsors
          come from the sponsorship spreadsheet the sales side already keeps.
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
                <span className="muted">nobody at this tier</span>
              ) : (
                g.rows.map((s) => s.name).join(', ')
              )}
            </span>,
          ])}
        />
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          Logo weight is Whova&rsquo;s own sizing ratio from the live sponsor widget. Nothing here
          applies it — see below.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What a tier should buy, and where</h2>
        <p className="body-2">
          A tier is only worth anything if it decides placement, and placement needs a surface. The
          public sponsor page renders sponsors grouped by tier and is built. The other three
          surfaces Whova sells against are not:
        </p>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Banners in the app.</strong> There is no banner component on any screen, so
            there is nothing for a placement rule to place. <Tag color="grey" small>unbuilt</Tag>
          </li>
          <li>
            <strong>Sponsored sessions.</strong> <code>SessionDoc</code> has no sponsor field, so a
            sponsor cannot be attached to a talk. <Tag color="grey" small>unbuilt</Tag>
          </li>
          <li>
            <strong>Push and announcement placement.</strong> Announcements exist and have no
            sponsor slot. <Tag color="grey" small>unbuilt</Tag>
          </li>
        </ul>
        <p className="body-2">
          Roughly <strong>2–3 days</strong> once one banner surface exists, and none of it is
          blocked on tiers being editable.
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
            <strong>Moving a sponsor between tiers.</strong> Sponsor Manager is read-only; the tier
            is set by the importer.
          </li>
          <li>
            <strong>Benefits per tier.</strong> Whova records what each tier includes and checks it
            off. Nothing models a benefit, so nothing can be checked off.
          </li>
          <li>
            <strong>Placement rules.</strong> The weights above are printed, not applied.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
