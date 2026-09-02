import Link from 'next/link';
import { publicSiteOrigin } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { Banner, PageHeader, Panel, Table } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tools › App Adoption › Web App Link.
 *
 * ── ⚠️ There is no web app, and this screen exists to say so ────────────────
 *
 * Whova serves a browser version of the attendee app for people who will not
 * install anything. Ours is React Native under Expo and there is no web build
 * shipped anywhere — `app/` exports for iOS and Android only.
 *
 * The honest content of this screen is therefore the *other* links: what an
 * attendee can do in a browser today, which is more than nothing. The agenda,
 * the speakers and their own ticket are all on the public site.
 */
export default async function WebAppLinkPage() {
  await requireOrganizer();
  const origin = publicSiteOrigin();

  return (
    <>
      <PageHeader
        title="Web App Link"
        links={[
          <Link key="b" href="/tools/app-adoption/app-download-button">
            Download button
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>There is no browser version of the attendee app.</strong> Whova has one; this app is
        React Native and exports for iOS and Android only. An attendee who will not install
        anything can still use the public website for the agenda and their ticket — but not the
        badge QR, messages or session Q&amp;A.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What works in a browser today</h2>
        <Table
          cols={[
            { key: 'w', label: 'What', className: 'cell-md' },
            { key: 'u', label: 'Link', className: 'cell-fill' },
            { key: 'n', label: '', className: 'cell-md' },
          ]}
          rows={[
            [
              'The full agenda',
              <a key="u" href={`${origin}/agenda`} target="_blank" rel="noreferrer">
                {origin}/agenda ↗
              </a>,
              <span key="n" className="muted" style={{ fontSize: 12 }}>
                same data as the app
              </span>,
            ],
            [
              'Speakers',
              <a key="u" href={`${origin}/speakers`} target="_blank" rel="noreferrer">
                {origin}/speakers ↗
              </a>,
              <span key="n" className="muted" style={{ fontSize: 12 }}>
                same data as the app
              </span>,
            ],
            [
              'Their own ticket',
              <span key="u" className="muted">
                the /order link in their confirmation email
              </span>,
              <span key="n" className="muted" style={{ fontSize: 12 }}>
                shows the claim code
              </span>,
            ],
            [
              'Badge QR, messages, Q&A',
              <span key="u" className="muted">
                app only
              </span>,
              <span key="n" className="muted" style={{ fontSize: 12 }}>
                no browser equivalent
              </span>,
            ],
          ]}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What a web app would take</h2>
        <p className="body-2">
          Expo can target web, so a build is not the hard part. The hard part is that the badge QR
          is the app&rsquo;s reason to exist at the door, and a browser tab is a worse place to keep
          a credential than an installed app — it is closed, it is shared, it is on a laptop
          upstairs. AGENTS.md sets out the badge threat model in detail and it assumes a phone.
        </p>
        <p className="body-2">
          The narrower and more useful version is a <strong>printable badge</strong> from the
          confirmation page, which needs no app at all and solves the same problem for the same
          person. That is Attendees &rsaquo; Name Badges, and it is unbuilt.
        </p>
      </Panel>
    </>
  );
}
