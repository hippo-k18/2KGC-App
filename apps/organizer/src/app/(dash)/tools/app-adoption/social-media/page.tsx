import Link from 'next/link';
import { publicSiteOrigin } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { eventAnalytics } from '@/lib/exports';
import { GapPanel, PageHeader, Panel, StatTiles } from '../../../ui';
import { Snippet, eventWindow } from '../snippet';

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
  const [a, dates] = await Promise.all([eventAnalytics(), eventWindow()]);
  const origin = publicSiteOrigin();
  const missing = a.ticketHolders - a.ticketHoldersSignedIn;

  const posts = [
    {
      label: 'Announcing the app',
      text: `The KGC 2027 app is live. Your agenda, your badge, and everyone else who's coming. All in one place.\n\nGet it: ${origin}/tickets\n\n#KGC2027 #KnowledgeGraphs`,
    },
    {
      label: 'A week out',
      text: `One week until KGC 2027 at Cornell Tech.\n\nIf you have a ticket, get the app before you travel. It has your badge QR, and the door scans it.\n\n${origin}/tickets`,
    },
    {
      label: 'Day one, morning',
      text: `Doors are open at Cornell Tech. Registration is on your right.\n\nBadge on your phone: open the KGC app, tap Me, then Badge.\n\n#KGC2027`,
    },
    {
      label: 'For speakers to share',
      text: `I'm speaking at KGC 2027${dates ? `, ${dates}` : ''} at Cornell Tech in New York.\n\nThe full programme is up: ${origin}/agenda\n\n#KGC2027`,
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

      <StatTiles
        tiles={[
          { label: 'App adoption', value: `${a.adoptionPct}%`, sub: `${a.ticketHoldersSignedIn} of ${a.ticketHolders}` },
          { label: 'Have not installed', value: missing, sub: 'who these posts are for' },
          { label: 'Ticket holders', value: a.ticketHolders, sub: 'total' },
        ]}
      />

      <Panel>
        {posts.map((p) => (
          <Snippet
            key={p.label}
            title={p.label}
            /*
              The character count is on every block because these go to accounts
              with different limits and a post that is silently truncated loses
              the link, which is the only part of it that does any work.
            */
            note={`${p.text.length} characters`}
            text={p.text}
          />
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
            <strong>Generated images.</strong> There is no server-side image renderer; storage for
            the output exists. See Downloadable Graphics, whose printable sign is the one graphic
            that needs no renderer at all.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
