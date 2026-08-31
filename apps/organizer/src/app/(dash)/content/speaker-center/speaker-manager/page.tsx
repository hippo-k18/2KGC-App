import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { getSpeaker, listSpeakers } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { GapPanel, PER_PAGE, PageHeader, Pagination, Panel, SearchInput, StatTiles, Table, Tag, listParams, paginate, sortRows } from '../../../ui';
import { Dropdown, RowActions } from '../../../menu';
import { CsvImportPanel } from '../../csv-import-panel';
import { commitSpeakerImportAction, previewSpeakerImportAction } from './actions';
import { SpeakerForm, type EditableSpeaker } from './speaker-form';

export const dynamic = 'force-dynamic';

/**
 * Content > Speaker Center > Speaker Manager.
 *
 * Whova's three stat tiles across the top are TOTAL SPEAKERS / NUMBER OF EDITED
 * PROFILES / SPEAKERS WHO RECEIVED LINK. The third counts emails we cannot send
 * yet, so it is replaced with the number that actually drives work here —
 * profiles missing a bio or a photo — and the substitution is called out on the
 * tile rather than left to look like the Whova metric.
 *
 * The research is explicit about what earns this screen its place at 150
 * speakers: the completeness column and the bulk reminder. Both are here now —
 * the reminder as a link into Message Speakers with the segment preselected,
 * because that screen already resolves the audience and already refuses to
 * pretend it reached the people with no address on file.
 *
 * ── There is no delete, and that is the design ──────────────────────────────
 *
 * The row menu offered "Remove speaker" as a permanently greyed-out item. It is
 * gone rather than wired: a `speakers` document is what `SessionDoc.speakerIds`
 * points at, what the app's speaker page resolves, and what `speakerNames`
 * falls back to when a read fails. Deleting one turns each of those into a
 * dangling pointer and the symptom surfaces days later as a talk with an author
 * that no longer exists. The house pattern here is retirement, not deletion —
 * `setExhibitorStatusAction` cancels rather than deletes for the same reason,
 * and `firestore.rules:388` refuses a session delete outright — and a speaker
 * is retired by taking them off their sessions in Session Manager, which leaves
 * the record findable. The panel below says so on screen.
 */
export default async function SpeakerManagerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();

  const sp = await searchParams;
  const filter = typeof sp.filter === 'string' ? sp.filter : undefined;
  const q = typeof sp.q === 'string' ? sp.q : undefined;
  const editId = typeof sp.edit === 'string' ? sp.edit : undefined;
  const creating = typeof sp.new === 'string';
  const { page, sort, baseParams } = listParams(sp);
  const all = await listSpeakers();

  const doc = editId ? await getSpeaker(editId) : null;
  /**
   * Mapped rather than spread: `getSpeaker` returns Firestore `Timestamp`s on
   * `createdAt` and `updatedAt`, and a Server Component may hand a client
   * component only plain values.
   */
  const editing: EditableSpeaker | undefined = doc
    ? {
        id: doc.id,
        name: doc.name,
        title: doc.title,
        company: doc.company,
        bio: doc.bio,
        contactEmail: doc.contactEmail,
        photoURL: doc.photoURL,
        linkedin: doc.social?.linkedin,
        x: doc.social?.x,
        website: doc.social?.website,
        userId: doc.userId,
        sessionCount: doc.sessionIds?.length ?? 0,
      }
    : undefined;
  const showForm = creating || Boolean(editing);

  const noBio = all.filter((s) => !s.hasBio);
  const noPhoto = all.filter((s) => !s.hasPhoto);
  const noSession = all.filter((s) => s.sessionCount === 0);
  const complete = all.filter((s) => s.hasBio && s.hasPhoto);
  const noEmail = all.filter((s) => !s.contactEmail);

  const base =
    filter === 'no-bio'
      ? noBio
      : filter === 'no-photo'
        ? noPhoto
        : filter === 'no-session'
          ? noSession
          : all;

  const needle = (q ?? '').trim().toLowerCase();
  const matched = needle
    ? base.filter((s) =>
        [s.name, s.title ?? '', s.company ?? ''].join(' ').toLowerCase().includes(needle),
      )
    : base;

  const rows = sortRows(matched, sort.by, sort.dir, {
    speaker: (s) => s.name,
    affiliation: (s) => s.company ?? '',
    sessions: (s) => s.sessionCount,
    profile: (s) => Number(s.hasBio) + Number(s.hasPhoto),
  });
  const pageRows = paginate(rows, page, PER_PAGE);

  const href = (f?: string) => {
    const p = new URLSearchParams();
    if (f) p.set('filter', f);
    if (q) p.set('q', q);
    const s = p.toString();
    return s ? `?${s}` : ROUTES.speakerManager;
  };

  const chips: [string, string, number][] = [
    ['All Speakers', '', all.length],
    ['No bio', 'no-bio', noBio.length],
    ['No photo', 'no-photo', noPhoto.length],
    ['No session', 'no-session', noSession.length],
  ];

  return (
    <>
      <PageHeader
        title="Speaker Manager"
        tags={
          <Tag color="green" fill="outline">
            ✓ Enabled
          </Tag>
        }
        actions={
          showForm ? (
            <Link href={ROUTES.speakerManager} className="whova-btn-main secondary">
              Back to list
            </Link>
          ) : null
        }
        links={[
          <Link key="sc" href="/content/speaker-center">
            Speaker Center
          </Link>,
          <Link key="ms" href={ROUTES.messageSpeakers}>
            Message Speakers
          </Link>,
        ]}
      />

      {showForm ? (
        <Panel>
          <h2 className="section-header" style={{ marginTop: 0 }}>
            {editing ? `Edit ${editing.name}` : 'New speaker'}
          </h2>
          <SpeakerForm existing={editing} />
        </Panel>
      ) : (
        <Panel>
          <StatTiles
            tiles={[
              { label: 'Total speakers', value: all.length },
              {
                label: 'Complete profiles',
                value: complete.length,
                sub: `${all.length - complete.length} missing a bio or a photo`,
              },
              {
                label: 'No contact address',
                value: noEmail.length,
                // Whova's third tile counts sent invite links. We do not mint
                // per-speaker links, so this is the number that actually blocks
                // the same job: nobody in this count can be chased at all.
                sub: 'cannot be emailed a reminder',
              },
            ]}
          />

          <h2 className="section-header">Speaker list</h2>

          <div className="toolbar">
            <Link href="?new=1" className="btn btn-primary">
              + Add speaker
            </Link>
            <a href="/export/speakers" className="btn btn-default" download>
              Export speakers
            </a>
            <span className="spacer" />
            <Dropdown
              label="Email reminder"
              className="btn btn-primary"
              align="end"
              items={[
                {
                  label: `Chase incomplete profiles (${all.length - complete.length})`,
                  href: `${ROUTES.messageSpeakers}?segment=incomplete`,
                },
                {
                  label: `Speakers with no session (${noSession.length})`,
                  href: `${ROUTES.messageSpeakers}?segment=no-session`,
                },
                { label: 'Everyone', href: `${ROUTES.messageSpeakers}?segment=all` },
              ]}
            />
          </div>

          <form method="get" className="toolbar">
            {filter ? <input type="hidden" name="filter" value={filter} /> : null}
            <SearchInput defaultValue={q} placeholder="Search by speaker name, title or affiliation" />
            <button type="submit" className="btn btn-default">
              Search
            </button>
            {q ? (
              <Link className="btn btn-default" href={filter ? `?filter=${filter}` : ROUTES.speakerManager}>
                Clear
              </Link>
            ) : null}
          </form>

          <div className="toolbar">
            {chips.map(([label, f, n]) => (
              <Link
                key={label}
                className={`whova-tag-main ${(filter ?? '') === f ? 'blue-tag solid-tag' : 'grey-tag outline-tag'}`}
                href={href(f || undefined)}
                style={{ textDecoration: 'none' }}
              >
                {label} ({n})
              </Link>
            ))}
          </div>

          <Table
            cols={[
              { key: 's', label: 'Speaker', className: 'cell-md', sortKey: 'speaker' },
              { key: 'a', label: 'Affiliation', className: 'cell-mdsm', sortKey: 'affiliation' },
              { key: 'p', label: 'Profile', className: 'cell-sm', sortKey: 'profile' },
              { key: 'x', label: 'Session(s)', className: 'cell-fill', sortKey: 'sessions' },
              { key: 'act', label: '', className: 'cell-xs cell-end-align' },
            ]}
            sort={sort}
            empty="Your event has no speakers"
            rows={pageRows.map((s) => [
              <span key="s">
                <strong>{s.name}</strong>
                {s.title ? (
                  <div className="muted" style={{ fontSize: 12 }}>
                    {s.title}
                  </div>
                ) : null}
              </span>,
              s.company ?? <span className="muted">—</span>,
              <span key="p" style={{ display: 'flex', gap: 4 }}>
                <Tag color={s.hasBio ? 'green' : 'red'} small>
                  bio
                </Tag>
                <Tag color={s.hasPhoto ? 'green' : 'red'} small>
                  photo
                </Tag>
              </span>,
              s.sessionCount === 0 ? (
                <Tag key="x" color="red">
                  no session
                </Tag>
              ) : (
                <span style={{ fontSize: 13 }}>{s.sessionTitles.join(' · ')}</span>
              ),
              <RowActions
                key="act"
                items={[
                  { label: 'Edit speaker', href: `?edit=${encodeURIComponent(s.id)}` },
                  /*
                    A `mailto:` rather than a send. Message Speakers owns bulk
                    email and refuses to pretend it reached anyone with no
                    address; a one-off note to one speaker is a thing an
                    organizer does from their own outbox, where the reply lands.
                    Absent — not greyed out — when there is nothing to send to.
                  */
                  ...(s.contactEmail
                    ? [{ label: 'Email speaker', href: `mailto:${s.contactEmail}` }]
                    : []),
                ]}
              />,
            ])}
          />
          <Pagination total={rows.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />

          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 12 }}>
            <strong>There is no delete.</strong> Sessions point at a speaker by id, and so does
            every phone that has one of their talks saved — removing the document would leave those
            resolving to nothing, days later and with no warning. A speaker who has dropped out is
            taken off their sessions in{' '}
            <Link href={ROUTES.sessionManager}>Session Manager</Link>, which leaves the record
            findable and the agenda correct.
          </p>
        </Panel>
      )}

      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          Import a speaker list
        </h2>
        <p className="body-2">
          The list the call for papers produced, straight from the committee&rsquo;s spreadsheet.
          Re-import it as bios and headshots arrive &mdash; a speaker already on the list is matched
          by name and updated rather than duplicated, and a blank cell leaves what is stored alone.
        </p>
        <p className="muted" style={{ fontSize: 12 }}>
          Import this before the agenda. The session importer refuses any row naming a speaker it
          cannot find, rather than inventing a thin record that nothing would ever merge.
        </p>
        <CsvImportPanel
          previewAction={previewSpeakerImportAction}
          commitAction={commitSpeakerImportAction}
          nounSingular="speaker"
          nounPlural="speakers"
          columnHint={
            <>
              Needs a <strong>Name</strong> column. Job title, Company, Bio, Photo URL, Contact
              email, LinkedIn and Website are used if present. Column names are matched loosely, so
              &ldquo;Affiliation&rdquo; and &ldquo;Full name&rdquo; both work.
            </>
          }
          placeholder={'Name,Job title,Company,Contact email\nAda Okonkwo,Principal Engineer,Acme Graphs,ada@acme.example'}
          additiveNote={
            <>
              Nothing was removed. A speaker missing from the file stays on the list &mdash; an
              import is additive, and there is no delete here to undo one with. Correcting a
              spelling is a rename, which has to fan out to every session that caches the name, so
              it is done on the speaker&rsquo;s own page rather than from a spreadsheet.
            </>
          }
        />
      </Panel>

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>The speaker self-service form.</strong> Whova&apos;s whole design here is that
            organizers never collect bios by email — each speaker gets a personal link and fills
            their own profile in, and the reminder schedule chases the ones who have not. That
            personal-link pattern is Whova&apos;s real permission model and it is worth copying;
            the mechanism to generalise is <code>/order/{'{token}'}</code>.
          </li>
          <li>
            <strong>Release &amp; consent forms.</strong> One per event in Whova, and it locks at
            publish; deleting it requires emailing their support.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
