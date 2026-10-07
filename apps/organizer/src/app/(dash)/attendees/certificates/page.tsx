import Link from 'next/link';
import { EVENT } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { attendeeAttendance, formatHours } from '@/lib/attendance';
import { lastWording, listCertificates } from '@/lib/certificates';
import { DEFAULT_LIST_ID, listRegistrations, listStations, recentCheckIns } from '@/lib/checkin';
import { ROUTES } from '@/lib/nav';
import { Email, GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../ui';
import { PrintButton } from '../name-badges/print-button';
import { IssueForm } from './issue-form';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Certificates.
 *
 * Attendance certificates are the feature that makes an event billable for
 * anyone claiming CPE or CE credit. This screen issues them and prints them.
 *
 * ── Issue, then print — two steps on purpose ────────────────────────────────
 *
 * Issuing writes `certificates/{registrationId}` with the hours, the sessions,
 * the wording and the signatory copied in. The sheet below renders from those
 * documents rather than from live attendance, so a scan landing afterwards
 * cannot silently change what the paper in somebody's file says. Re-issuing
 * overwrites — one authoritative statement per person — and the audit log keeps
 * the count and the wording of every run.
 *
 * ── The printer is the browser, as it is for name badges ────────────────────
 *
 * `window.print()` and a `@media print` block, no PDF library and nothing to
 * install on the machine at the desk. What that does *not* give is a thousand
 * individually addressed emails: this dashboard has no per-recipient send
 * queue, and the honest position is that certificates here are printed or saved
 * to PDF by the browser and distributed by whoever handles the mailing list.
 */
export default async function CertificatesPage() {
  await requireOrganizer();

  /**
   * One `where('eventId', '==', …)` per collection and no `orderBy` beside it:
   * a second field would need a composite index this repo does not declare, and
   * the emulator does not enforce indexes, so it would pass here and fail in
   * production with `failed-precondition`. Counting happens in memory.
   */
  const [registrations, stations, hours, issued] = await Promise.all([
    listRegistrations(),
    listStations(),
    attendeeAttendance(),
    listCertificates(),
  ]);
  const rows = registrations.map((r) => r.row);
  const { total: attended } = await recentCheckIns(DEFAULT_LIST_ID, rows, stations);

  const active = rows.filter((r) => r.status === 'active');
  const totalMinutes = hours.rows.reduce((n, r) => n + r.minutes, 0);
  const wording = lastWording(issued);

  const issuedIds = new Set(issued.map((c) => c.registrationId));
  const notYetIssued = hours.rows.filter((r) => !issuedIds.has(r.registration.id)).length;

  return (
    <>
      {/*
        Hiding everything else by visibility rather than `display: none` keeps
        the sheet's own layout intact — a display-none ancestor collapses the
        boxes and the certificates reflow mid-print. Same trick, and the same
        reason, as the badge sheet.
      */}
      <style>{`
        .cert-sheet { display: grid; gap: 24px; }
        .cert {
          border: 1px solid var(--hairline);
          border-radius: 6px;
          box-sizing: border-box;
          padding: 36px 40px;
          text-align: center;
        }
        .cert-logo { display: block; margin: 0 auto 14px; max-height: 64px; width: auto; }
        .cert-event { font-size: 13px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
        .cert-kind { font-size: 26px; font-weight: 500; margin-top: 10px; }
        .cert-name { font-size: 34px; font-weight: 600; margin: 18px 0 8px; overflow-wrap: anywhere; }
        .cert-statement { font-size: 15px; margin: 0 auto; max-width: 34em; }
        .cert-hours { font-size: 17px; font-weight: 600; margin-top: 14px; }
        .cert-sessions { font-size: 12px; margin: 8px auto 0; max-width: 40em; }
        .cert-foot { display: flex; gap: 24px; justify-content: space-between; margin-top: 32px; text-align: left; }
        .cert-sign { border-top: 1px solid #999; font-size: 12px; padding-top: 6px; min-width: 40%; }
        @media print {
          @page { margin: 0.5in; size: landscape; }
          body * { visibility: hidden; }
          .cert-sheet, .cert-sheet * { visibility: visible; }
          .cert-sheet { left: 0; position: absolute; top: 0; width: 100%; }
          .cert { break-after: page; border-color: #999; }
        }
      `}</style>

      <PageHeader
        title="Certificates"
        info={
          <>
            <strong>Printed here, not emailed</strong>
            <p>
              Certificates are printed or saved as PDF from your browser. They are not emailed.
            </p>
            <p>
              Hours are each session&rsquo;s scheduled length. Only sessions with check-in opened
              count.
            </p>
          </>
        }
        tags={<Tag color="blue">{issued.length} issued</Tag>}
        actions={issued.length > 0 ? <PrintButton count={issued.length} label="certificate" /> : undefined}
        links={[
          <Link key="a" href={ROUTES.attendees}>
            Attendees
          </Link>,
          <Link key="c" href={ROUTES.checkIn}>
            Check-in
          </Link>,
          <Link key="s" href="/attendees/check-in-and-checkout/session-self-check-in">
            Room doors
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          {
            label: 'Qualify',
            value: hours.rows.length,
            sub: `counted into a session · ${hours.tracked} of ${hours.live} rooms had a door`,
          },
          {
            label: 'Issued',
            value: issued.length,
            sub: notYetIssued > 0 ? `${notYetIssued} qualify and have none` : 'everyone who qualifies',
          },
          {
            label: 'Hours certified',
            value: totalMinutes > 0 ? formatHours(totalMinutes) : '—',
            sub: totalMinutes > 0 ? 'scheduled, across every attendee' : 'none yet',
          },
          {
            label: 'At the door only',
            value: Math.max(0, attended - hours.rows.length),
            sub: `of ${active.length} active registrations, no session hours`,
          },
        ]}
      />

      <Panel>
        <h2 className="section-header">Issue</h2>
        <p className="body-2">
          Issues one certificate to each attendee counted into at least one session, with their
          hours and session titles as of now. Issue again after more scans to update everyone.
        </p>
        <IssueForm
          statement={wording.statement}
          signatoryName={wording.signatoryName}
          signatoryRole={wording.signatoryRole}
          logoUrl={wording.logoUrl}
          qualifying={hours.rows.length}
        />
      </Panel>

      <Panel>
        <h2 className="section-header">Hours by attendee ({hours.rows.length})</h2>
        <div style={{ marginBottom: 10 }}>
          {hours.rows.length > 0 ? (
            <a href="/export/attendance-hours" className="whova-btn-main small" download>
              Download CSV
            </a>
          ) : null}
        </div>
        {hours.rows.length === 0 ? (
          <NotInputted
            what="session attendance"
            action={
              <Link className="btn btn-primary" href={ROUTES.checkIn}>
                Open a session door
              </Link>
            }
          />
        ) : (
          <Table
            cols={[
              { key: 'n', label: 'Attendee', className: 'cell-md' },
              { key: 't', label: 'Ticket', className: 'cell-sm' },
              { key: 'c', label: 'Sessions', className: 'cell-xs' },
              { key: 'h', label: 'Scheduled hours', className: 'cell-sm' },
              { key: 'i', label: 'Certificate', className: 'cell-fill' },
            ]}
            rows={hours.rows.map((r) => {
              const cert = issued.find((c) => c.registrationId === r.registration.id);
              return [
                <span key="n">
                  <strong>{r.registration.name}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    <Email address={r.registration.email} />
                  </div>
                </span>,
                r.registration.ticketType ?? <span className="muted">—</span>,
                r.sessions.length,
                <strong key="h">{formatHours(r.minutes)}</strong>,
                cert ? (
                  <span key="i" style={{ fontSize: 12 }}>
                    <Tag color="green" small>
                      issued
                    </Tag>{' '}
                    {cert.issuedAt ? cert.issuedAt.slice(0, 10) : ''}
                    {cert.minutes !== r.minutes ? (
                      /*
                        The certificate is a frozen statement, so a later scan
                        makes it stale rather than wrong. Saying which figure is
                        on the paper is the only way an organizer knows a
                        re-issue is needed.
                      */
                      <div className="muted">
                        issued at {formatHours(cert.minutes)}. Attendance has moved since
                      </div>
                    ) : null}
                  </span>
                ) : (
                  <span key="i" className="muted" style={{ fontSize: 12 }}>
                    not issued
                  </span>
                ),
              ];
            })}
          />
        )}
      </Panel>

      {issued.length > 0 ? (
        <Panel>
          <h2 className="section-header">Certificates to print ({issued.length})</h2>
          <p className="body-2">
            One per page, landscape. Printing takes every issued certificate. Use the browser&rsquo;s
            &ldquo;Save as PDF&rdquo; to get a file per run rather than a stack of paper.
          </p>
          <div className="cert-sheet">
            {issued.map((c) => (
              <div className="cert" key={c.registrationId}>
                {/*
                  A plain `<img>` rather than `next/image`: this element is
                  printed, and the optimiser's srcset plus lazy loading are two
                  ways for a print job to render an empty box. Whatever is here
                  was pinned at issue time — either an uploaded logo's Firebase
                  Storage download URL, or `DEFAULT_LOGO_URL`, the bundled KGC
                  mark served from this app's own `public/`. It is read off the
                  document and never resolved again, so it is not a lookup.
                */}
                {c.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="cert-logo" src={c.logoUrl} alt="" />
                ) : null}
                <div className="cert-event">{EVENT.name}</div>
                <div className="cert-kind">Certificate of Attendance</div>
                <div className="cert-name">{c.name}</div>
                <p className="cert-statement">{c.statement}</p>
                <div className="cert-hours">
                  {formatHours(c.minutes)} across {c.sessionTitles.length}{' '}
                  {c.sessionTitles.length === 1 ? 'session' : 'sessions'}
                </div>
                {c.sessionTitles.length > 0 ? (
                  <p className="cert-sessions muted">{c.sessionTitles.join(' · ')}</p>
                ) : null}
                <p className="cert-sessions muted">
                  Hours are the scheduled length of the sessions this attendee was counted into.
                </p>
                <div className="cert-foot">
                  <div className="cert-sign">
                    {c.signatoryName}
                    {c.signatoryRole ? (
                      <div className="muted">{c.signatoryRole}</div>
                    ) : null}
                  </div>
                  <div className="cert-sign" style={{ textAlign: 'right' }}>
                    Issued {c.issuedAt ? c.issuedAt.slice(0, 10) : '—'}
                    <div className="muted">{EVENT.venue}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Sending them.</strong> Issued and printable; not mailed. A per-attendee PDF
            posted to a thousand addresses is a job for a queue with per-recipient status and
            bounce handling, and this dashboard has none — the transactional path in{' '}
            <code>@kgc/scripts/src/lib</code> sends one template to one address at a time.
          </li>
          <li>
            <strong>Time in the seat, as opposed to time at the door.</strong> Hours are the
            session&apos;s <em>scheduled</em> length. A departure is not recorded anywhere, so the
            number cannot be narrowed; closing this needs Checkout — an append-only movement log
            beside <code>checkIns</code> and a direction on the scanner.
          </li>
          <li>
            <strong>Coverage warnings.</strong> A session only has hours if somebody opened its
            door. Nothing warns an organizer at 17:00 that four of the day&apos;s rooms were never
            scanned, which is when it is still fixable.
          </li>
          <li>
            <strong>Self-serve download.</strong> Whova lets an attendee fetch their own
            certificate. That is a route in the app plus a rule allowing a holder to read their own
            attendance, and today <code>checkIns</code> has no client rule at all.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
