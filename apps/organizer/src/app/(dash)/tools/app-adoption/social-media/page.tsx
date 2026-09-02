import Link from 'next/link';
import { publicSiteOrigin } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { eventAnalytics } from '@/lib/exports';
import { Banner, GapPanel, PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tools › App Adoption › Social Media.
 *
 * Copy for the accounts KGC already posts from. Nothing here connects to a
 * social platform — see the note at the bottom about why that is a bigger job
 * than it looks and a worse idea than it sounds.
 */
export default async function SocialMediaPage() {
  await requireOrganizer();
  const a = await eventAnalytics();
  const origin = publicSiteOrigin();

  const posts = [
    {
      label: 'Announcing the app',
      text: `The KGC 2027 app is live. Your agenda, your badge, and everyone else who's coming — all in one place.\n\nGet it: ${origin}/tickets\n\n#KGC2027 #KnowledgeGraphs`,
    },
    {
      label: 'A week out',
      text: `One week until KGC 2027 at Cornell Tech.\n\nIf you have a ticket, get the app before you travel — it has your badge QR, and the door scans it.\n\n${origin}/tickets`,
    },
    {
      label: 'Day one, morning',
      text: `Doors are open at Cornell Tech. Registration is on your right.\n\nBadge on your phone: open the KGC app, tap Me, then Badge.\n\n#KGC2027`,
    },
    {
      label: 'For speakers to share',
      text: `I'm speaking at KGC 2027, 3–7 May at Cornell Tech in New York.\n\nThe full programme is up: ${origin}/agenda\n\n#KGC2027`,
    },
  ];

  return (
    <>
      <PageHeader
        title="Social Media"
        links={[
          <Link key="e" href="/tools/app-adoption/app-adoption-email">
            Adoption email
          </Link>,
          <Link key="b" href="/tools/app-adoption/app-download-button">
            Download button
          </Link>,
        ]}
      />

      <Banner kind="info">
        Copy for the accounts KGC already posts from. Adoption is currently{' '}
        <strong>{a.adoptionPct}%</strong> — {a.ticketHolders - a.ticketHoldersSignedIn} ticket holders have not
        installed the app.
      </Banner>

      <Panel>
        {posts.map((p) => (
          <div key={p.label} style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 14, marginBottom: 6, marginTop: 0 }}>{p.label}</h2>
            <pre className="whova-code">{p.text}</pre>
            <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              {p.text.length} characters
            </p>
          </div>
        ))}
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Posting from this dashboard.</strong> It would mean holding OAuth tokens for
            KGC&rsquo;s social accounts behind a shared passphrase with no per-person identity —
            the same objection as the bank details on Pay &rsaquo; Billing Information, and the
            same answer: those credentials belong behind their own login.
          </li>
          <li>
            <strong>Scheduling.</strong> Same argument as announcements and bulk email: a queued
            post fires whether or not anybody is awake to stop it.
          </li>
          <li>
            <strong>Generated images.</strong> No asset pipeline exists — see Downloadable
            Graphics.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
