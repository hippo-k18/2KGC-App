import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { pageReadiness, publicUrl } from '@/lib/webpages';
import { GapPanel, NotInputted, PageHeader, Panel, StatTiles, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Branding Center › Web App Speaker Page.
 *
 * Two speaker pages exist in the navigation and they are easy to confuse. The
 * *marketing* speaker webpage is a public list you embed on your own site — that
 * one is built, at Marketing › Event Webpages › Speaker Webpage. This one is the
 * **web app** speaker page: the signed-in speaker view inside a browser version
 * of the event app.
 *
 * There is no web app. The attendee experience is an Expo build for iOS and
 * Android, and `apps/web` is a marketing and ticketing site with no signed-in
 * event surface at all. So the customisation this screen would offer has nothing
 * to customise — but the *content* it would show is real, so the readiness
 * figures below are computed from the actual speaker records rather than mocked.
 */
export default async function WebAppSpeakerPagePage() {
  await requireOrganizer();

  const { speakers } = await pageReadiness();

  return (
    <>
      <PageHeader
        title="Web App Speaker Page"
        info={
          <>
            <strong>There is no web app to brand</strong>
            <p>
              Attendees get a native iOS and Android build; <code>apps/web</code> sells tickets and
              has no signed-in event surface. The same speaker records do render on the public
              speakers page and in the app&rsquo;s People tab, and the figures below are theirs.
            </p>
          </>
        }
        tags={<Tag color="grey">no web app</Tag>}
        links={[
          <Link key="m" href="/marketing/event-webpages/speaker-webpage">
            Speaker Webpage (public)
          </Link>,
          <Link key="s" href="/content/speaker-center/speaker-manager">
            Speaker Manager
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Speakers', value: speakers.total, sub: 'on file for this event' },
          {
            label: 'Missing a photo',
            value: speakers.problems.find((p) => p.label === 'no photo')?.count ?? 0,
            sub: 'the most visible gap on any speaker grid',
          },
          {
            label: 'Missing a bio',
            value: speakers.problems.find((p) => p.label === 'no bio')?.count ?? 0,
            sub: 'chased through Message Speakers',
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Where this content does render</h2>
        <p className="body-2">
          The same speaker records already render in two places that exist: the People tab of the
          mobile app, and the public speakers page at <code>{publicUrl(speakers.path)}</code>. Both
          read the identical documents, so the numbers above are the ones a visitor would see today.
        </p>
        {speakers.problems.length > 0 ? (
          <ul className="body-2" style={{ paddingLeft: 18 }}>
            {speakers.problems.map((p) => (
              <li key={p.label}>
                <strong>{p.count}</strong> {p.label}
              </li>
            ))}
          </ul>
        ) : speakers.total === 0 ? (
          <NotInputted what="speakers" compact />
        ) : (
          <p className="body-2">Nothing on the speaker records is currently missing.</p>
        )}
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>A browser client for attendees.</strong> The largest missing piece by an order
            of magnitude — it is a second implementation of the whole event app, against the same
            Firestore rules but with a different auth surface. Weeks, not days, and it is a product
            decision rather than a screen.
          </li>
          <li>
            <strong>Layout choices.</strong> Grid or list, with or without company names,
            alphabetical or by session order. The mobile People tab hard-codes one layout and takes
            no configuration.
          </li>
          <li>
            <strong>Featured speakers.</strong> <code>SpeakerDoc</code> has no ordering or
            &ldquo;featured&rdquo; field, so keynotes cannot be floated to the top of anything. That
            one is cheap — a field, a form control and a sort — if it is ever wanted.
          </li>
          <li>
            <strong>Branding.</strong> Same wall as App Branding: the palette and the logo are
            compiled into the app bundle, so nothing stored here would reach a phone.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
