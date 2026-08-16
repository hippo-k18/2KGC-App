import Link from 'next/link';
import type { SponsorTier } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listSponsors, TIER_ORDER, type SponsorRow } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * Content > Sponsor Center > Sponsor Manager — §9.2.
 *
 * Grouped by tier, in tier order, because in Whova that one ordering drives
 * three surfaces at once: the manager, the sponsor webpage and the event
 * website (§9.2). Read-only for the same reason as the Track Manager — §35.1
 * says exhibitors and sponsors are a handful of records authored in the
 * sponsorship spreadsheet the sales side already keeps, and that importing them
 * plus a self-service profile link beats a manager grid by ~6 days.
 */
export default async function SponsorManagerPage() {
  await requireOrganizer();
  const sponsors = await listSponsors();

  const byTier = TIER_ORDER.map((tier) => ({
    tier,
    rows: sponsors.filter((s) => s.tier === tier),
  })).filter((g) => g.rows.length > 0);

  const missingLogo = sponsors.filter((s) => !s.hasLogo).length;

  return (
    <>
      <p className="crumbs">
        <Link href="/content">Content</Link> {' › '}
        <Link href="/content/sponsor-center">Sponsor Center</Link> {' › '}
      </p>
      <h1>Sponsor Manager</h1>
      <p className="muted">
        {sponsors.length} sponsors across {byTier.length} tiers. Whova&apos;s own distinction
        (§9.1): sponsors buy brand visibility, exhibitors buy direct engagement and booth staff.
        There is no exhibitor model here at all.
      </p>

      {byTier.map(({ tier, rows }) => (
        <TierTable key={tier} tier={tier} rows={rows} />
      ))}

      {missingLogo > 0 ? (
        <p className="error">
          {missingLogo} of {sponsors.length} sponsors have no <code>logoURL</code>. The app&apos;s
          People tab renders a name where a logo should be — which is the one thing a sponsor
          notices.
        </p>
      ) : null}

      <h2>Not built here</h2>
      <ul className="muted" style={{ maxWidth: 780 }}>
        <li>
          <strong>Creating a tier.</strong> <code>SponsorTier</code> is a hard-coded union of five
          values in <code>models.ts</code> (<code>diamond</code>, <code>platinum</code>,{' '}
          <code>gold</code>, <code>silver</code>, <code>startup</code>), so a sixth tier is a code
          change and a deploy. Whova lets you add one inline and drag to reorder (§9.2). At one
          event a year, twice a year, the code change is the cheaper trade — but it is a trade, not
          an oversight.
        </li>
        <li>
          <strong>Logo upload.</strong> Needs Firebase Storage and storage rules.{' '}
          <code>logoURL</code> is a plain string today, set by the importer.
        </li>
        <li>
          <strong>Sponsor Tiering</strong> (§9.3) — deciding where each tier&apos;s banner appears
          (Home, Agenda, Profile) and attaching sponsors to sessions, maximum three per session.
          That needs rendering slots in the Expo app that do not exist.
        </li>
        <li>
          <strong>Message Sponsors and the profile reminder</strong> (§9.2, §18.3). There is no
          contact email on <code>SponsorDoc</code>, and sending needs an ESP on the Blaze plan.
        </li>
        <li>
          <strong>Leads.</strong> <code>sponsors/&#123;id&#125;/leads/&#123;uid&#125;</code> is
          modelled — an attendee asking a sponsor to get in touch — and nothing reads or writes it
          yet. §34 puts lead retrieval at 5–7 days and notes it is what sponsors actually pay for;
          §37 open question 5 asks whether it is a contracted deliverable at KGC.
        </li>
      </ul>
    </>
  );
}

function TierTable({ tier, rows }: { tier: SponsorTier; rows: SponsorRow[] }) {
  return (
    <>
      <h2 style={{ textTransform: 'capitalize' }}>
        {tier} ({rows.length})
      </h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Booth</th>
            <th>Website</th>
            <th>Logo</th>
            <th>Offers</th>
            <th>Downloads</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td>
                <strong>{s.name}</strong>
                {s.description ? <div className="muted">{s.description}</div> : null}
              </td>
              <td>{s.boothLocation ?? <span className="muted">—</span>}</td>
              <td>
                {s.website ? (
                  <a href={s.website} rel="noreferrer">
                    link
                  </a>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td className={s.hasLogo ? 'ok' : 'error'}>{s.hasLogo ? 'yes' : 'no'}</td>
              <td>{s.offerCount}</td>
              <td>{s.downloadCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
