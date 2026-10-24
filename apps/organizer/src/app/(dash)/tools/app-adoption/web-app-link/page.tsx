import Link from 'next/link';
import { publicSiteOrigin } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { PageHeader, Panel, Table } from '../../../ui';
import { QrSymbol, Snippet } from '../snippet';

export const dynamic = 'force-dynamic';

/**
 * Tools › App Adoption › Web App Link.
 *
 * Whova serves a browser version of the attendee app. Ours is React Native
 * under Expo and `app/` exports for iOS and Android only, so there is no
 * equivalent URL to hand out.
 *
 * The useful content of this screen is therefore the *other* links — what an
 * attendee who will not install anything can genuinely do in a browser today,
 * which is more than nothing — and every one of them is a live URL on the
 * deployed public site rather than a description of one.
 */
export default async function WebAppLinkPage() {
  await requireOrganizer();
  const origin = publicSiteOrigin();

  /**
   * Only the two pages that render the same data the app does.
   *
   * `/order/{token}` is deliberately absent from this list: it is per-buyer and
   * capability-scoped, so it cannot be published, and printing a generic
   * `/order` here would send people to a page that refuses them.
   */
  const browsable = [
    { what: 'The full agenda', path: '/agenda', note: 'same sessions, tracks and speakers as the app' },
    { what: 'Speakers', path: '/speakers', note: 'same profiles as the app' },
    { what: 'Tickets and how to get the app', path: '/tickets', note: 'where an attendee starts' },
  ];

  return (
    <>
      <PageHeader
        title="Web App Link"
        info={
          <>
            <strong>There is no browser version of the attendee app</strong>
            <p>
              The app runs on iOS and Android only. The agenda and speakers are also on the website,
              and those links are below. The badge QR, messages and session Q&amp;A are in the app
              only.
            </p>
          </>
        }
        links={[
          <Link key="b" href="/tools/app-adoption/app-download-button">
            Download button
          </Link>,
          <Link key="g" href="/tools/app-adoption/downloadable-graphics">
            Downloadable graphics
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What works in a browser today</h2>
        <Table
          cols={[
            { key: 'w', label: 'What', className: 'cell-md' },
            { key: 'u', label: 'Link', className: 'cell-fill' },
            { key: 'n', label: '', className: 'cell-md' },
          ]}
          rows={[
            ...browsable.map((b) => [
              b.what,
              <a key="u" href={`${origin}${b.path}`} target="_blank" rel="noreferrer">
                {origin}
                {b.path} ↗
              </a>,
              <span key="n" className="muted" style={{ fontSize: 12 }}>
                {b.note}
              </span>,
            ]),
            [
              'Their own ticket',
              <span key="u" className="muted">
                the link in their confirmation email
              </span>,
              <span key="n" className="muted" style={{ fontSize: 12 }}>
                different for every buyer
              </span>,
            ],
            [
              'Badge QR, messages, Q&A',
              <span key="u" className="muted">
                app only
              </span>,
              <span key="n" className="muted" style={{ fontSize: 12 }}>
                <Link href="/attendees/name-badges">printed badges</Link> work at the door
              </span>,
            ],
          ]}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
          <QrSymbol text={`${origin}/agenda`} px={150} label={`${origin}/agenda`} />
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <h2 style={{ fontSize: 15, marginTop: 0 }}>The agenda, for a sign or a slide</h2>
            <p className="body-2">
              Anyone can open the agenda link. It needs no account, app or ticket.
            </p>
            <Snippet title="Plain text" text={`KGC 2027 agenda: ${origin}/agenda`} />
          </div>
        </div>
      </Panel>
    </>
  );
}
