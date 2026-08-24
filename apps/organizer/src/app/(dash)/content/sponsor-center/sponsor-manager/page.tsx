/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import type { SponsorTier } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listSponsors, TIER_ORDER, type SponsorRow } from '@/lib/data';
import { Banner, EmptyState, PageHeader, Panel, Tabs, Tag } from '../../../ui';
import { Dropdown, RowActions } from '../../../menu';

export const dynamic = 'force-dynamic';

/**
 * Content > Sponsor Center > Sponsor Manager.
 *
 * Whova does not render sponsors as a table. It renders tier group bars — a
 * grey band with the tier name, a drag handle and Edit / Delete links — with
 * ~80px sponsor rows beneath: a 72×72 logo, then captioned fields ("Sponsor",
 * "Main Contact") whose labels sit inside the row rather than in a header. That
 * is copied here, because the grouping *is* the information: tier order drives
 * three surfaces at once — this screen, the sponsor webpage and the event
 * website — and a flat sortable table hides the thing you came to check.
 *
 * `<img>` rather than `next/image` on purpose: these are remote logos on hosts
 * we do not control and cannot enumerate in `next.config.ts`, and the
 * optimiser would either need a wildcard remote pattern (which is a fetch-any
 * proxy) or fail closed on the first new sponsor. The eslint rule is disabled
 * for that reason and no other.
 *
 * Read-only, and honestly so. Sponsors are a handful of records authored in the
 * sponsorship spreadsheet the sales side already keeps; importing them plus a
 * self-service profile link beats a manager grid by about six days.
 */

function TierGroup({ tier, rows }: { tier: SponsorTier; rows: SponsorRow[] }) {
  return (
    <div style={{ border: '1px solid var(--hairline)', borderRadius: 4, marginBottom: 14, overflow: 'hidden' }}>
      <div
        style={{
          alignItems: 'center',
          background: 'var(--surface-alt)',
          borderBottom: '1px solid var(--hairline)',
          display: 'flex',
          gap: 10,
          padding: '8px 12px',
        }}
      >
        <span aria-hidden="true" className="muted">
          ✥
        </span>
        <strong style={{ textTransform: 'capitalize' }}>{tier}</strong>
        <Tag color="blue">{rows.length}</Tag>
        <span style={{ flex: 1 }} />
        <RowActions
          items={[
            { label: 'Edit tier', disabled: true },
            { label: 'Delete tier', danger: true, disabled: true },
          ]}
        />
      </div>

      {rows.map((s) => (
        <div
          key={s.id}
          style={{
            alignItems: 'center',
            borderBottom: '1px solid var(--hairline)',
            display: 'flex',
            gap: 16,
            minHeight: 80,
            padding: '10px 12px',
          }}
        >
          <div
            style={{
              alignItems: 'center',
              background: '#fff',
              border: '1px solid var(--hairline)',
              borderRadius: 3,
              display: 'flex',
              flex: 'none',
              height: 72,
              justifyContent: 'center',
              overflow: 'hidden',
              width: 72,
            }}
          >
            {s.logoURL ? (
              <img
                src={s.logoURL}
                alt=""
                style={{ maxHeight: 64, maxWidth: 64, objectFit: 'contain' }}
              />
            ) : (
              <span className="muted" style={{ fontSize: 11, textAlign: 'center' }}>
                no logo
              </span>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="muted" style={{ fontSize: 11 }}>
              Sponsor
            </div>
            {s.website ? (
              <a href={s.website} target="_blank" rel="noreferrer" style={{ fontSize: 15 }}>
                {s.name}
              </a>
            ) : (
              <span style={{ fontSize: 15 }}>{s.name}</span>
            )}
          </div>

          <div style={{ width: 150 }}>
            <div className="muted" style={{ fontSize: 11 }}>
              Booth
            </div>
            <div style={{ fontSize: 14 }}>{s.boothLocation ?? '—'}</div>
          </div>

          <div style={{ width: 130 }}>
            <div className="muted" style={{ fontSize: 11 }}>
              Offers / downloads
            </div>
            <div style={{ fontSize: 14 }}>
              {s.offerCount} / {s.downloadCount}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function SponsorManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireOrganizer();
  const { tab } = await searchParams;
  const sponsors = await listSponsors();

  const byTier = TIER_ORDER.map((tier) => ({
    tier,
    rows: sponsors.filter((s) => s.tier === tier),
  })).filter((g) => g.rows.length > 0);

  const missingLogo = sponsors.filter((s) => !s.hasLogo).length;

  return (
    <>
      <PageHeader
        title="Sponsor Manager"
        links={[
          <Link key="sc" href="/content/sponsor-center">
            Sponsor Center
          </Link>,
          <Link key="st" href="/content/sponsor-center/sponsor-tiering">
            Sponsor Tiering
          </Link>,
        ]}
      />

      <Panel>
        <Tabs
          tabs={[
            { label: '☰ Sponsors List', href: '?', active: tab !== 'reminder' },
            { label: '✉ Sponsor Profile Reminder', href: '?tab=reminder', active: tab === 'reminder' },
          ]}
        />

        {tab === 'reminder' ? (
          <EmptyState icon="✉">
            Sponsor profile reminders need an email sender
          </EmptyState>
        ) : (
        <>
        <p className="body-2" style={{ marginTop: 0 }}>
          {sponsors.length} sponsors across {byTier.length} tiers. Whova&apos;s own distinction:
          sponsors buy brand visibility, exhibitors buy direct engagement and booth staff. There is
          no exhibitor model here at all.
        </p>

        <div className="toolbar">
          <button type="button" className="btn btn-primary" disabled title="Not built — see below">
            Import from Excel
          </button>
          <button type="button" className="btn btn-primary" disabled title="Not built — see below">
            Add Sponsor
          </button>
          <button type="button" className="btn btn-primary" disabled title="Not built — see below">
            Settings
          </button>
          <span className="spacer" />
          <Dropdown
            label="Export"
            className="btn btn-default"
            align="end"
            items={[
              { label: 'Export sponsors to Excel', disabled: true },
              { label: 'Export lead lists', disabled: true },
            ]}
          />
        </div>

        {missingLogo > 0 ? (
          <Banner kind="danger">
            {missingLogo} of {sponsors.length} sponsors have no <code>logoURL</code>. The app&apos;s
            People tab renders a name where a logo should be — which is the one thing a sponsor
            notices.
          </Banner>
        ) : null}

        {byTier.length === 0 ? (
          <EmptyState icon="🏛">Your event has no sponsors</EmptyState>
        ) : (
          byTier.map(({ tier, rows }) => <TierGroup key={tier} tier={tier} rows={rows} />)
        )}
        </>
        )}
      </Panel>

      <Panel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Creating a tier.</strong> <code>SponsorTier</code> is a hard-coded union of the
            four values the conference actually sells — <code>platinum</code>, <code>gold</code>,{' '}
            <code>silver</code>, <code>bronze</code> — so a fifth tier is a code change in{' '}
            <code>models.ts</code>, not a form. That is the right trade at one event a year and
            the wrong one at ten.
          </li>
          <li>
            <strong>The sponsor self-service portal.</strong> Whova hands each sponsor a personal
            link to fill in their own logo, description, offers and documents. Same pattern as
            speakers, same blocker: an email sender.
          </li>
          <li>
            <strong>Banners and sponsored sessions.</strong> Tiering decides placement in Whova and
            there are no banner surfaces in the app to place anything on yet.
          </li>
          <li>
            <strong>Lead retrieval.</strong> <code>sponsors/&#123;id&#125;/leads</code> is modelled
            and empty. The badge QR that would feed it already works — a booth scan is the same
            write the check-in desk does, against a different list.
          </li>
        </ul>
      </Panel>
    </>
  );
}
