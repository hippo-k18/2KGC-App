import Link from 'next/link';
import { EVENT } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listRooms } from '@/lib/data';
import { SETTINGS_KEYS } from '@/lib/settings';
import { Banner, PageHeader, Panel, StatTiles } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Logistics Center.
 *
 * The practical information an attendee looks up on their phone while standing
 * outside the venue: address, doors, wifi, parking, accessibility, the nearest
 * coffee. Whova gives it a screen in the app and a form here.
 *
 * Two thirds of the plumbing exists and the missing third is the one that
 * matters. `SETTINGS_KEYS.logistics` is already declared in
 * `src/lib/settings.ts`, so the storage and the audited write are free — but
 * **there is no logistics screen in the app to read it**. The five tabs are Home,
 * Agenda, People, Community and Me, declared as native tabs at build time, and
 * none of them has a slot for venue information.
 *
 * A form here would therefore write a document nothing reads. That is the same
 * trade App Branding makes deliberately and explains on the page; the difference
 * is that branding has an argument for recording the decision anyway, and
 * logistics does not — wifi passwords typed into a dashboard nobody reads back
 * are worse than a note in the shared drive, because they look filed.
 */
export default async function LogisticsCenterPage() {
  await requireOrganizer();

  const rooms = await listRooms();

  return (
    <>
      <PageHeader
        title="Logistics Center"
        links={[
          <Link key="b" href="/content/basics">
            Basics
          </Link>,
          <Link key="d" href="/content/documents-and-videos/documents">
            Documents
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>No form here, because nothing would read it.</strong> The settings bag exists (
        <code>{SETTINGS_KEYS.logistics}</code>) and writing to it is two hours&rsquo; work. The app
        has no screen for venue information, so the value would sit in Firestore looking filed and
        reach no attendee.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Rooms', value: rooms.length, sub: 'real, and used by the agenda' },
          { label: 'Editable fields', value: 0, sub: 'nothing on this screen writes' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What is already fixed</h2>
        <p className="body-2">
          The venue is <strong>{EVENT.venue}</strong>, and it is a compile-time constant in{' '}
          <code>@kgc/shared</code> shared by the app, the seed script, the importer and this
          dashboard — deliberately, so the four cannot drift. Basics explains why that is read-only
          rather than a text input.
        </p>
      </Panel>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does</h2>
        <p className="body-2">
          Venue address and map, arrival and parking notes, wifi network and password, accessibility
          information, shuttle times, and a set of custom sections an organizer writes themselves.
          All of it renders on one app screen the attendee reaches from the menu.
        </p>

        <h2 className="section-header">What this would need</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>A screen in the app — 2–3 days,</strong> and it is the whole job. Where it goes
            is the decision: the tab set is fixed at build time and adding a sixth tab means an
            iOS SF Symbol, an Android vector icon and a release, so realistically this lives under
            Home or Me rather than as a tab of its own.
          </li>
          <li>
            <strong>The form here — half a day</strong> once the screen exists, because{' '}
            <code>readSettings</code> and <code>saveSettings</code> already do the reading, the
            merging and the audit entry.
          </li>
        </ul>
        <p className="body-2">
          Built in that order, not this one. Building the form first is how a dashboard accumulates
          screens that write to nothing.
        </p>

        <h2 className="section-header">What to do instead, today</h2>
        <p className="body-2">
          Add it as a document. The Documents screen writes a titled link the app already renders,
          which covers a venue map PDF or an arrival note — which is what most of this screen is
          used for.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Any editable logistics field.</strong> No venue notes, no wifi, no parking, no
            shuttle times.
          </li>
          <li>
            <strong>A venue map.</strong> The same missing floor plan that blocks booth selection
            and poster board numbering. There is no image upload anywhere in this project.
          </li>
          <li>
            <strong>Emergency information.</strong> Whova has a separate Emergency Manager under
            Virtual &amp; Hybrid; it is unbuilt too, and it is the one item on this page that would
            genuinely matter at 3pm on day two.
          </li>
        </ul>
      </Panel>
    </>
  );
}
