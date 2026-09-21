import Link from 'next/link';
import { STATUS_LABEL } from '@kgc/scripts/src/lib/speaker-portal-core';
import { requireOrganizer } from '@/lib/auth';
import { getSpeaker, imageSrc, listSpeakers, type SpeakerRow } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import {
  listPortalRows,
  pendingSubmissions,
  speakerEmailAvailable,
  speakerLinksAvailable,
  speakerPortalLink,
  trackerCounts,
} from '@/lib/speaker-portal';
import { DetailList, GapPanel, NotInputted, PER_PAGE, PageHeader, Pagination, Panel, Portrait, SearchInput, StatTiles, Table, Tag, listParams, paginate, sortRows } from '../../../ui';
import { DetailDisclosure } from '../../../form';
import { Dropdown, RowActions } from '../../../menu';
import { CsvImportPanel } from '../../csv-import-panel';
import { commitSpeakerImportAction, previewSpeakerImportAction } from './actions';
import { DecisionForm, RevokeLinkForm, SendLinkForm, type LinkTarget } from './portal-forms';
import { SpeakerForm, type EditableSpeaker } from './speaker-form';

export const dynamic = 'force-dynamic';

/**
 * Content > Speaker Center > Speaker Manager.
 *
 * Two things earn this screen its place at 150 speakers: the completeness
 * column and the bulk reminder. Both are here — the reminder as a link into
 * Message Speakers with the segment preselected, because that screen already
 * resolves the audience and already refuses to pretend it reached the people
 * with no address on file.
 *
 * ── Self-service, and where it sits on this screen ──────────────────────────
 *
 * Each speaker has a link of their own (`lib/speaker-portal.ts`) that opens a
 * page on the website where they fill in their own profile. Three things are
 * deliberate about how it appears here:
 *
 *   1. **Waiting submissions are above the list**, and the panel is absent when
 *      there are none. It is the only thing on this screen that is work on this
 *      desk rather than work somebody else owes.
 *   2. **The status column is blank for a speaker who was never sent a link.**
 *      A hundred and thirty-seven grey "not sent" tags is a column that hides
 *      the five rows worth looking at.
 *   3. **Sending is one form with a "Send to" list**, the shape the reviewers
 *      screen already uses, rather than a checkbox on every row. The two groups
 *      an organizer actually sends to are "everyone missing something" and
 *      "everyone", and a selection UI is a lot of table state for that.
 *
 * The third stat tile is Whova's count of invitations sent, which this screen
 * could not give until the links existed.
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
 *
 * ── The portrait had never been rendered on this screen ─────────────────────
 *
 * The Profile column showed a green or red `photo` tag and the list showed no
 * faces at all, so "is that the right person, and the right way up" — the
 * question a headshot column exists to answer — could only be asked by opening
 * the editor one speaker at a time. Clicking a name now opens the full record.
 * `imageSrc` is what makes the image load here at all; see its docblock.
 */

/**
 * One speaker, whole: portrait, affiliation, bio, links, and the sessions they
 * present.
 *
 * Rendered on the server and passed to `DetailDisclosure` as `children`, which
 * is what lets it use `Portrait`, `Tag` and `DetailList` — a client component
 * may not import `ui.tsx`, and that component's header says why.
 *
 * ── The bio empty state is deliberate, and it is not a placeholder ──────────
 *
 * On the live project not one of the 137 speakers has a bio: the roster came
 * out of the 2026 Whova export via `scripts/src/import-speakers-2026.ts`, and
 * `speakers-2026.ts` carries no bio field to import — so `hasBio` is false for
 * every row and the "No bio" chip above selects all of them. ⚠️ The seeded
 * emulator is not that shape (`fixtures.ts` gives every speaker a bio), so the
 * empty state is the case you will *not* see locally.
 *
 * Two things follow. A "Bio coming soon" placeholder is out — it would be the
 * dashboard asserting something that is true nowhere, the defect class
 * AGENTS.md counts fourteen instances of. But saying nothing is wrong too: this
 * is the screen where a bio gets written, the modal already carries the Edit
 * speaker button that starts it, and an organizer who cannot tell "no bio" from
 * "bio not shown here" cannot plan the chase. So the section is always drawn
 * and says which of the two it is, and the sentence is a statement about the
 * record rather than a promise about the future.
 */
function SpeakerDetail({ s, portalLink }: { s: SpeakerRow; portalLink?: string }) {
  const links = [
    ['LinkedIn', s.social?.linkedin],
    ['X', s.social?.x],
    ['Website', s.social?.website],
  ].filter((l): l is [string, string] => Boolean(l[1]));

  return (
    <>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <Portrait src={s.photoURL} name={s.name} size={96} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{s.name}</div>
          {s.title ? <div style={{ fontSize: 14 }}>{s.title}</div> : null}
          {s.company ? (
            <div className="muted" style={{ fontSize: 14 }}>
              {s.company}
            </div>
          ) : null}
          {!s.hasPhoto ? (
            <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
              No headshot on file. The initials above are what the badge, the agenda and the
              speakers page all fall back to.
            </p>
          ) : null}
        </div>
      </div>

      <DetailList
        items={[
          {
            label: 'Job title',
            value: s.title ?? <span className="muted">Not set</span>,
          },
          {
            label: 'Affiliation',
            value: s.company ?? <span className="muted">Not set</span>,
          },
          {
            label: 'Contact',
            value: s.contactEmail ? (
              <a href={`mailto:${s.contactEmail}`}>{s.contactEmail}</a>
            ) : (
              /*
               * Worth saying on the detail rather than leaving blank: an address
               * is what the bio chase is sent to, so a speaker without one is
               * the reason a reminder never lands. The stat tile above counts
               * them for the same reason.
               */
              <span className="muted">No address. Cannot be sent a reminder.</span>
            ),
          },
          /*
           * The link itself, spelled out rather than hidden behind the send
           * button. Email is the normal way it reaches somebody, but an
           * organizer who is already in a thread with a speaker wants to paste
           * it there — and on a deployment with no mail provider that is the
           * only way it can be delivered at all.
           */
          ...(portalLink
            ? [
                {
                  label: 'Profile link',
                  value: (
                    <code style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{portalLink}</code>
                  ),
                },
              ]
            : []),
          {
            label: 'Links',
            value: links.length ? (
              <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 12 }}>
                {links.map(([label, url]) => (
                  <a key={label} href={url} target="_blank" rel="noreferrer">
                    {label}
                  </a>
                ))}
              </span>
            ) : (
              <span className="muted">Not set</span>
            ),
          },
        ]}
      />

      <h3 className="section-header">Bio</h3>
      {s.bio ? (
        <p style={{ lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{s.bio}</p>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          No bio on file. The app and the website show this speaker&rsquo;s name, affiliation and
          sessions without one.
        </p>
      )}

      <h3 className="section-header">
        Sessions {s.sessionCount ? <span className="muted">({s.sessionCount})</span> : null}
      </h3>
      {s.sessions.length ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {s.sessions.map((x) => (
            <li key={x.id} style={{ borderTop: '1px solid var(--hairline)', padding: '8px 0' }}>
              <Link href={`${ROUTES.sessionManager}/${x.id}`}>{x.title}</Link>
              {x.startsAtLocal ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  {x.day} · {x.startsAtLocal.slice(11, 16)}
                </div>
              ) : (
                /*
                 * `sessionIds` named a session that is not there. Shown rather
                 * than dropped: the inverse index is written by the session
                 * editor and a stale entry here is the first visible sign it
                 * went out of step.
                 */
                <div className="muted" style={{ fontSize: 12 }}>
                  No session record for this id.
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          Not on the programme. A speaker is put on a session in Session Manager.
        </p>
      )}
    </>
  );
}

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
  /** Set by Send link on a speaker's row, so the picker below opens on them. */
  const sendTo = typeof sp.send === 'string' ? sp.send : undefined;
  const creating = typeof sp.new === 'string';
  const { page, sort, baseParams } = listParams(sp);
  const [all, portal, pending] = await Promise.all([
    listSpeakers(),
    listPortalRows(),
    pendingSubmissions(),
  ]);
  const linksOn = speakerLinksAvailable();
  const emailOn = speakerEmailAvailable();

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
        /*
         * Resolved, not raw. The form's headshot preview showed a broken image
         * for every imported speaker because `photoURL` is a path on the
         * *website's* origin — `imageSrc` is where that is explained. The
         * preview is display-only and is never posted back, so the absolute URL
         * reaches nothing that writes.
         */
        photoURL: imageSrc(doc.photoURL),
        linkedin: doc.social?.linkedin,
        x: doc.social?.x,
        website: doc.social?.website,
        userId: doc.userId,
        sessionCount: doc.sessionIds?.length ?? 0,
        featured: doc.featured,
        displayOrder: doc.displayOrder,
      }
    : undefined;
  const showForm = creating || Boolean(editing);

  const noBio = all.filter((s) => !s.hasBio);
  const noPhoto = all.filter((s) => !s.hasPhoto);
  const noSession = all.filter((s) => s.sessionCount === 0);
  const complete = all.filter((s) => s.hasBio && s.hasPhoto);
  const noEmail = all.filter((s) => !s.contactEmail);

  /*
   * The self-service tracker, counted once so the tiles, the chips and the
   * status column cannot disagree about who is where.
   */
  const tracker = trackerCounts(
    all.map((s) => ({ status: portal.get(s.id)?.status, canBeSent: Boolean(s.contactEmail) })),
  );
  const linkTargets: LinkTarget[] = all.map((s) => {
    const status = portal.get(s.id)?.status;
    return {
      id: s.id,
      name: s.name,
      hasAddress: Boolean(s.contactEmail),
      statusLabel: status ? STATUS_LABEL[status] : undefined,
    };
  });
  const linksSent = [...portal.values()].filter((r) => r.linkSentAtMs).length;
  const sessionTitleFor = (field: string, titles: Record<string, string>) =>
    field.startsWith('slides:') ? titles[field.slice('slides:'.length)] : undefined;

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
        <>
        {/*
          Above the list, and only when there is something in it. This is the
          one thing on this screen that is somebody's to do today: a speaker has
          written their own bio and it is not on the website until an organizer
          reads it.
        */}
        {pending.length > 0 && (
          <Panel>
            <h2 className="section-header" style={{ marginTop: 0 }}>
              Profile updates waiting ({pending.length})
            </h2>
            <p className="body-2">
              Sent in by speakers through their own link. Nothing here is on the website or in the
              app until you approve it. Once you decide, the speaker leaves this list and the
              answer shows against their name below.
            </p>
            {pending.map((p) => (
              <div
                key={p.speakerId}
                style={{ borderTop: '1px solid var(--hairline)', padding: '16px 0' }}
              >
                <h3 className="section-header" style={{ marginTop: 0 }}>
                  {p.speakerName}
                </h3>
                {p.changes.length === 0 ? (
                  <p className="muted" style={{ marginTop: 0 }}>
                    Nothing they sent is different from what is on the record. Approving marks it
                    as done and changes nothing.
                  </p>
                ) : (
                  <DetailList
                    items={p.changes.map((c) => ({
                      label: c.label,
                      value: (
                        <>
                          {/*
                            The talk a slides link belongs to sits in the value
                            rather than beside the label: `.detail-list dt` is
                            small and upper-cased, which is right for "Slides"
                            and unreadable for a sentence-length session title.
                          */}
                          {sessionTitleFor(c.field, p.sessionTitles) ? (
                            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                              {sessionTitleFor(c.field, p.sessionTitles)}
                            </div>
                          ) : null}
                          {c.before ? (
                            <div
                              className="muted"
                              style={{
                                marginBottom: 4,
                                overflowWrap: 'anywhere',
                                textDecoration: 'line-through',
                                whiteSpace: 'pre-wrap',
                              }}
                            >
                              {c.before}
                            </div>
                          ) : null}
                          {c.after ? (
                            <div style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
                              {c.after}
                            </div>
                          ) : (
                            <Tag color="red" small>
                              asks to remove this
                            </Tag>
                          )}
                        </>
                      ),
                    }))}
                  />
                )}
                <DecisionForm speakerId={p.speakerId} />
              </div>
            ))}
          </Panel>
        )}

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
                // Whova's third tile counts sent invite links, and this is now
                // that number. The sub-line is the one an organizer acts on:
                // a submission waiting for a decision is work on this desk,
                // not work somebody else owes.
                label: 'Profile links sent',
                /*
                 * Counted from the send itself, not from the status. A link an
                 * organizer pasted into their own message moves a speaker
                 * through the tracker without this dashboard ever mailing
                 * anything, and a tile saying "sent" about a mail that does not
                 * exist is the defect class AGENTS.md counts.
                 */
                value: linksSent,
                sub:
                  tracker.submitted > 0
                    ? `${tracker.submitted} waiting for you`
                    : `${tracker.notSent} not sent yet`,
              },
              {
                label: 'No contact address',
                value: noEmail.length,
                sub: 'cannot be sent a link',
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

          {all.length === 0 ? (
            <NotInputted
              what="speakers"
              action={
                <Link className="whova-btn-main secondary" href="?new=1">
                  Add the first one
                </Link>
              }
            />
          ) : (
            <>
          <Table
            cols={[
              { key: 's', label: 'Speaker', className: 'cell-md', sortKey: 'speaker' },
              { key: 'a', label: 'Affiliation', className: 'cell-mdsm', sortKey: 'affiliation' },
              { key: 'p', label: 'Profile', className: 'cell-sm', sortKey: 'profile' },
              { key: 'ss', label: 'Self-service', className: 'cell-sm' },
              { key: 'x', label: 'Session(s)', className: 'cell-fill', sortKey: 'sessions' },
              { key: 'act', label: '', className: 'cell-xs cell-end-align' },
            ]}
            sort={sort}
            empty="Nothing here yet"
            rows={pageRows.map((s) => [
              <DetailDisclosure
                key="s"
                trigger={
                  <span style={{ alignItems: 'center', display: 'flex', gap: 10, minWidth: 0 }}>
                    <Portrait src={s.photoURL} name={s.name} size={32} />
                    <span style={{ minWidth: 0 }}>
                      <strong>{s.name}</strong>
                      {s.title ? (
                        <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                          {s.title}
                        </span>
                      ) : null}
                    </span>
                  </span>
                }
                triggerLabel={`Speaker details: ${s.name}`}
                triggerStyle={{
                  background: 'none',
                  border: 0,
                  cursor: 'pointer',
                  font: 'inherit',
                  padding: 0,
                  textAlign: 'left',
                  width: '100%',
                }}
                title={s.name}
                footer={
                  <Link
                    className="whova-btn-main small secondary"
                    href={`?edit=${encodeURIComponent(s.id)}`}
                  >
                    Edit speaker
                  </Link>
                }
              >
                <SpeakerDetail
                  s={s}
                  portalLink={linksOn ? speakerPortalLink(s.id) : undefined}
                />
              </DetailDisclosure>,
              s.company ?? <span className="muted">not set</span>,
              <span key="p" style={{ display: 'flex', gap: 4 }}>
                <Tag color={s.hasBio ? 'green' : 'red'} small>
                  bio
                </Tag>
                <Tag color={s.hasPhoto ? 'green' : 'red'} small>
                  photo
                </Tag>
              </span>,
              /*
               * One of five words, or nothing at all. A speaker who has never
               * been sent a link is blank rather than tagged "not sent": 137
               * grey tags saying the same thing is a column that hides the five
               * rows worth looking at.
               */
              (() => {
                const status = portal.get(s.id)?.status;
                if (!status) return <span key="ss" className="muted" style={{ fontSize: 12 }}>—</span>;
                return (
                  <Tag
                    key="ss"
                    small
                    color={
                      status === 'submitted'
                        ? 'orange'
                        : status === 'approved'
                          ? 'green'
                          : status === 'rejected'
                            ? 'red'
                            : 'grey'
                    }
                  >
                    {STATUS_LABEL[status]}
                  </Tag>
                );
              })(),
              s.sessionCount === 0 ? (
                <Tag key="x" color="red">
                  no session
                </Tag>
              ) : (
                <span style={{ fontSize: 13 }}>{s.sessions.map((x) => x.title).join(' · ')}</span>
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
                    Absent Not greyed out… when there is nothing to send to.
                  */
                  ...(s.contactEmail
                    ? [{ label: 'Email speaker', href: `mailto:${s.contactEmail}` }]
                    : []),
                  /*
                    Jumps to the self-service panel with this speaker already
                    chosen. Offered only where a link can actually be sent: on
                    a speaker with no address it would take the organizer to a
                    picker that refuses the row they came from.
                  */
                  ...(linksOn && s.contactEmail
                    ? [
                        {
                          label: 'Send profile link',
                          href: `?send=${encodeURIComponent(s.id)}#speaker-self-service`,
                        },
                      ]
                    : []),
                ]}
              />,
            ])}
          />
          <Pagination total={rows.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />
            </>
          )}

          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 12 }}>
            <strong>Speakers cannot be deleted.</strong> Take a speaker who has dropped out off
            their sessions in <Link href={ROUTES.sessionManager}>Session Manager</Link> instead.
          </p>
        </Panel>

        <Panel>
          <h2 className="section-header" id="speaker-self-service" style={{ marginTop: 0 }}>
            Speaker self-service
          </h2>
          <p className="body-2">
            Each speaker gets their own link to fill in their bio, job title, company, photo, links
            and a link to their slides. What they send waits here until you approve it. A link
            lasts six months and works without an account or a password.
          </p>

          {linksOn ? (
            <>
              <div className="toolbar" style={{ gap: 16 }}>
                {(
                  [
                    ['Not sent', tracker.notSent],
                    ['Link sent', tracker.sent],
                    ['Opened', tracker.opened],
                    ['Waiting for you', tracker.submitted],
                    ['Approved', tracker.approved],
                    ['Turned down', tracker.rejected],
                    ['No address', tracker.noAddress],
                  ] as [string, number][]
                ).map(([label, n]) => (
                  <span key={label} style={{ fontSize: 13 }}>
                    <strong>{n}</strong> <span className="muted">{label.toLowerCase()}</span>
                  </span>
                ))}
              </div>

              <SendLinkForm
                speakers={linkTargets}
                incompleteCount={
                  all.filter((s) => s.contactEmail && (!s.hasBio || !s.hasPhoto)).length
                }
                emailOn={emailOn}
                preselected={sendTo}
              />

              {/*
                Every speaker, not only the ones this dashboard has mailed. A
                link is just as often pasted into an organizer's own message —
                which is the only way to deliver one while email is off — and a
                revoke list built from what we sent would have no entry for the
                speaker whose link actually leaked.
              */}
              <div style={{ borderTop: '1px solid var(--hairline)', marginTop: 20, paddingTop: 16 }}>
                <RevokeLinkForm speakers={linkTargets} />
              </div>
            </>
          ) : (
            /*
             * One sentence, and it names the thing an owner has to supply. The
             * alternative is a Send button that throws inside the action with a
             * stack trace nobody on this screen can read.
             */
            <p className="muted" style={{ marginBottom: 0 }}>
              Speaker links are not switched on yet. They start working as soon as a signing key is
              set for this event.
            </p>
          )}
        </Panel>
        </>
      )}

      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          Import a speaker list
        </h2>
        <p className="body-2">
          Import the speaker list from a spreadsheet. A speaker already on the list is matched by
          name and updated, not duplicated. A blank cell leaves the stored value alone.
        </p>
        <p className="muted" style={{ fontSize: 12 }}>
          Import this before the agenda. The agenda import rejects any row naming a speaker it
          cannot find.
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
              Nothing was removed. A speaker missing from the file stays on the list. To correct a
              spelling, edit the speaker above. Changing a name in the file adds a second speaker.
            </>
          }
        />
      </Panel>

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>A reply to a speaker whose profile was turned down.</strong> The note an
            organizer types is their own record and reaches nobody. There is no channel from this
            dashboard to one speaker&rsquo;s inbox that is not a bulk send, so the honest answer
            today is that somebody writes to them.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
