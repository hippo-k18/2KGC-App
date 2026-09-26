import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { tierName } from '@kgc/shared';
import { listSponsors } from '@/lib/data';
import { sponsorTiers } from '@/lib/event';
import { publicUrl } from '@/lib/webpages';
import { GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Sponsor Center › Advanced Banners.
 *
 * ── Two surfaces, and only one of them exists ──────────────────────────────
 *
 * A sponsor banner rotation is weighted by tier. This project has two places a
 * sponsor can appear and they are in very different states:
 *
 *   **The website** renders sponsors from Firestore today, at
 *   `/sponsor`, grouped and ordered by tier. Editing a sponsor changes that
 *   page on the next request. That half is real, and this screen shows what a
 *   visitor sees and what is missing from it.
 *
 *   **The mobile app** has no banner surface at all. Not a broken one, not an
 *   empty one — there is no component anywhere in `app/` that renders a
 *   sponsor banner, so there is nothing for a placement rule to place. A
 *   rotation editor here would configure something that cannot exist, which is
 *   precisely the defect class `AGENTS.md` records fourteen instances of.
 *
 * ── So this screen computes the rotation rather than storing one ───────────
 *
 * Weight comes from the tier, and the tier is already on the sponsor. Storing a
 * second per-sponsor weight would mean two answers to "why is Acme above
 * Meridian?" and the stored one would go stale the moment a sponsor upgrades.
 * The order below is derived, so it cannot disagree with the sponsor records —
 * and it is the order the website already uses.
 */


export default async function AdvancedBannersPage() {
  await requireOrganizer();

  const [sponsors, tiers] = await Promise.all([listSponsors(), sponsorTiers()]);
  /** The logo size each tier was given on Sponsor Tiering. */
  const WEIGHT: Record<string, number> = Object.fromEntries(tiers.map((t) => [t.id, t.size]));

  const withLogo = sponsors.filter((s) => s.hasLogo);
  const withoutLogo = sponsors.filter((s) => !s.hasLogo);
  const noLink = sponsors.filter((s) => !s.website);

  /**
   * Impression share, computed rather than configured.
   *
   * Each sponsor's weight over the total, so an organizer can answer "what does
   * platinum actually buy?" with a number. Only sponsors with a logo count —
   * one without cannot appear in a rotation, so including it would overstate
   * the total and understate everybody else's share.
   */
  const totalWeight = withLogo.reduce((n, s) => n + (WEIGHT[s.tier] ?? 1), 0);

  const byTier = tiers.map(({ id: tier }) => {
    const inTier = sponsors.filter((s) => s.tier === tier);
    const shown = inTier.filter((s) => s.hasLogo);
    return {
      tier,
      count: inTier.length,
      shown: shown.length,
      weight: WEIGHT[tier] ?? 1,
      share: totalWeight > 0 ? (shown.length * (WEIGHT[tier] ?? 1)) / totalWeight : 0,
    };
  });

  return (
    <>
      <PageHeader
        title="Advanced Banners"
        info={
          <>
            <strong>Set by tier</strong>
            <p>
              The order below comes from each sponsor&rsquo;s tier. The public sponsor page uses
              it. Banners in the app are not available yet.
            </p>
          </>
        }
        tags={
          withoutLogo.length > 0 ? (
            <Tag color="orange">{withoutLogo.length} without a logo</Tag>
          ) : (
            <Tag color="green" fill="outline">
              {withLogo.length} in rotation
            </Tag>
          )
        }
        links={[
          <a key="v" href={publicUrl('/sponsor')} target="_blank" rel="noreferrer">
            The sponsor page ↗
          </a>,
          <Link key="m" href="/content/sponsor-center/sponsor-manager">
            Sponsor Manager
          </Link>,
          <Link key="t" href="/content/sponsor-center/sponsor-tiering">
            Sponsor Tiering
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Sponsors', value: sponsors.length, sub: `${withLogo.length} with a logo` },
          { label: 'Would rotate', value: withLogo.length, sub: 'have a logo' },
          { label: 'No logo', value: withoutLogo.length, sub: 'cannot be shown at all' },
          { label: 'No link', value: noLink.length, sub: 'shown, but not clickable' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Weight by tier</h2>
        <p className="body-2" style={{ marginTop: 0 }}>
          Platinum 3, Gold 2, Silver 1, Bronze 1. Share counts only sponsors with a logo.
        </p>
        <Table
          cols={[
            { key: 't', label: 'Tier', className: 'cell-sm' },
            { key: 'w', label: 'Weight', className: 'cell-xs' },
            { key: 'n', label: 'Sponsors', className: 'cell-sm' },
            { key: 's', label: 'Share of impressions', className: 'cell-fill' },
          ]}
          rows={byTier.map((r) => [
            <Tag key="t" small color={r.tier === tiers[0]?.id ? 'purple' : 'blue'}>
              {tierName(tiers, r.tier)}
            </Tag>,
            r.weight,
            <span key="n">
              {r.shown}
              {r.shown !== r.count ? (
                <span className="muted"> of {r.count}. Rest have no logo</span>
              ) : null}
            </span>,
            <span key="s" style={{ fontSize: 13 }}>
              {r.share > 0 ? `${(r.share * 100).toFixed(1)}%` : <span className="muted">0%</span>}
            </span>,
          ])}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The rotation, in order</h2>
        <p className="body-2" style={{ marginTop: 0 }}>
          The order follows each sponsor&rsquo;s tier. To move a sponsor, change their tier in{' '}
          <Link href="/content/sponsor-center/sponsor-manager">Sponsor Manager</Link>.
        </p>
        {sponsors.length === 0 ? (
          <NotInputted
            what="sponsors"
            action={
              <Link className="whova-btn-main primary" href="/content/sponsor-center/sponsor-manager?new=1">
                Add the first one
              </Link>
            }
          />
        ) : (
        <Table
          cols={[
            { key: 'p', label: '#', className: 'cell-xs' },
            { key: 'n', label: 'Sponsor', className: 'cell-fill' },
            { key: 't', label: 'Tier', className: 'cell-sm' },
            { key: 's', label: 'Ready', className: 'cell-md' },
          ]}
          rows={sponsors.map((s, i) => [
            <span key="p" className="muted">
              {i + 1}
            </span>,
            <div key="n">
              <div>{s.name}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {s.website ?? 'no link'}
              </div>
            </div>,
            <Tag key="t" small color={s.tier === tiers[0]?.id ? 'purple' : 'blue'}>
              {tierName(tiers, s.tier)}
            </Tag>,
            !s.hasLogo ? (
              <span key="s" style={{ color: 'var(--danger)', fontSize: 12 }}>
                no logo. Cannot be shown
              </span>
            ) : !s.website ? (
              <span key="s" className="muted" style={{ fontSize: 12 }}>
                shown, not clickable
              </span>
            ) : (
              <Tag key="s" color="green" small>
                ready
              </Tag>
            ),
          ])}
        />
        )}
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No banner surface in the app.</strong> The blocker, and it is an app change
            rather than a dashboard one: a component in <code>app/</code> that reads sponsors and
            renders a weighted rotation, plus a decision about where it sits without making the home
            screen an advertisement.
          </li>
          <li>
            <strong>No uploaded banner artwork.</strong> A rotation would use the logo, which is a
            square wordmark and not a banner. Storage uploads work now; what is missing is a
            banner-shaped field, a size spec sponsors can actually meet, and somewhere to show it.
          </li>
          <li>
            <strong>No impression or click counting.</strong> The number a sponsor asks for at
            renewal. Counting impressions from a mobile app needs either a write per view — which is
            a Firestore bill and a rate limit — or an aggregate trigger, and no trigger in this
            project has ever deployed.
          </li>
          <li>
            <strong>No sponsored-session placement.</strong> The upper tiers include one, and it is
            a session on the agenda rather than a banner. That belongs in{' '}
            <Link href="/content/agenda-center/session-manager">Session Manager</Link> and nothing
            marks a session as sponsored.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
