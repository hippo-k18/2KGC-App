import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listSponsors, TIER_ORDER } from '@/lib/data';
import { publicUrl } from '@/lib/webpages';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Sponsor Center › Advanced Banners.
 *
 * ── Two surfaces, and only one of them exists ──────────────────────────────
 *
 * Whova's banners appear inside their mobile app, on a rotation weighted by
 * tier. This project has two places a sponsor can appear and they are in very
 * different states:
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

/**
 * Whova's own size weights, from their public sponsor-design payload:
 * Platinum 3, Gold 2, Silver 1, Bronze 1. Copied because a rotation that
 * treats a platinum sponsor as a bronze one is a refund conversation.
 */
const WEIGHT: Record<string, number> = { platinum: 3, gold: 2, silver: 1, bronze: 1 };

export default async function AdvancedBannersPage() {
  await requireOrganizer();

  const sponsors = await listSponsors();

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

  const byTier = TIER_ORDER.map((tier) => {
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

      <Banner kind="warning">
        <strong>The app has no banner surface, so there is no rotation editor here.</strong> Nothing
        in <code>app/</code> renders a sponsor banner — not a broken component, not an empty one.
        Placement rules for a surface that does not exist would configure nothing, and a settings
        screen that configures nothing is worse than an honest empty one. The website{' '}
        <em>does</em> render sponsors, and what it shows is below.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Sponsors', value: sponsors.length, sub: `${withLogo.length} with a logo` },
          { label: 'Would rotate', value: withLogo.length, sub: 'on a surface that exists' },
          { label: 'No logo', value: withoutLogo.length, sub: 'cannot be shown at all' },
          { label: 'No link', value: noLink.length, sub: 'shown, but not clickable' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What a tier buys, as a number</h2>
        <p className="body-2" style={{ marginTop: 0 }}>
          Weights are Whova&rsquo;s own — Platinum 3, Gold 2, Silver 1, Bronze 1 — read from their
          public sponsor-design payload and copied rather than invented, because a rotation that
          treats a platinum sponsor as a bronze one is a refund conversation. Share counts only
          sponsors with a logo: one without cannot appear, and including it would overstate the
          total and understate everybody else.
        </p>
        <Table
          cols={[
            { key: 't', label: 'Tier', className: 'cell-sm' },
            { key: 'w', label: 'Weight', className: 'cell-xs' },
            { key: 'n', label: 'Sponsors', className: 'cell-sm' },
            { key: 's', label: 'Share of impressions', className: 'cell-fill' },
          ]}
          rows={byTier.map((r) => [
            <Tag key="t" small color={r.tier === 'platinum' ? 'purple' : 'blue'}>
              {r.tier}
            </Tag>,
            r.weight,
            <span key="n">
              {r.shown}
              {r.shown !== r.count ? (
                <span className="muted"> of {r.count} — rest have no logo</span>
              ) : null}
            </span>,
            <span key="s" style={{ fontSize: 13 }}>
              {r.share > 0 ? `${(r.share * 100).toFixed(1)}%` : <span className="muted">—</span>}
            </span>,
          ])}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The rotation, in order</h2>
        <p className="body-2" style={{ marginTop: 0 }}>
          Derived from the tier on each sponsor record, not stored. A second per-sponsor weight
          would mean two answers to &ldquo;why is one above the other?&rdquo;, and the stored one
          would go stale the moment a sponsor upgrades.
        </p>
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
            <Tag key="t" small color={s.tier === 'platinum' ? 'purple' : 'blue'}>
              {s.tier}
            </Tag>,
            !s.hasLogo ? (
              <span key="s" style={{ color: 'var(--danger)', fontSize: 12 }}>
                no logo — cannot be shown
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
          empty="No sponsors yet — add them in Sponsor Manager."
        />
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
            square wordmark and not a banner. Real banner assets need the Storage upload pipeline —
            blocker 3 in <code>ROADMAP.md</code> — plus a size spec sponsors can actually meet.
          </li>
          <li>
            <strong>No impression or click counting.</strong> The number a sponsor asks for at
            renewal. Counting impressions from a mobile app needs either a write per view — which is
            a Firestore bill and a rate limit — or an aggregate trigger, which needs Blaze.
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
