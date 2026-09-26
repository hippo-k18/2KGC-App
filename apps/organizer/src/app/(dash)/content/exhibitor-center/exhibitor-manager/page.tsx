import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { exhibitorSummary, getExhibitor, listExhibitors } from '@/lib/exhibitors';
import {
  leadDeskLink,
  leadEmailAvailable,
  leadLinkRows,
  leadLinksAvailable,
  totalLeads,
} from '@/lib/exhibitor-leads';
import { ROUTES } from '@/lib/nav';
import { stampOfMillis } from '@/lib/time';
import { leadLinkState } from '@kgc/shared';
import { Banner, Email, GapPanel, NotInputted, PER_PAGE, PageHeader, Pagination, Panel, ProgressBar, SearchInput, StatTiles, Table, Tag, listParams, paginate, sortRows } from '../../../ui';
import { setExhibitorStatusAction } from './actions';
import { ExhibitorForm } from './exhibitor-form';
import { RevokeLeadLinkForm, SendLeadLinkForm, type LeadLinkTarget } from './lead-forms';

export const dynamic = 'force-dynamic';

/**
 * Content › Exhibitor Center › Exhibitor Manager.
 *
 * Separate from Sponsor Manager on purpose. A sponsor buys visibility — a tier,
 * a logo, a banner. An exhibitor buys floor space — a booth, staff passes,
 * somewhere to scan leads. The fields barely intersect. A company that is both
 * is two records, which is correct: they bought two things.
 */
export default async function ExhibitorManagerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();
  const sp = await searchParams;
  const { page, sort, baseParams } = listParams(sp);
  const editId = typeof sp.edit === 'string' ? sp.edit : undefined;
  const creating = typeof sp.new === 'string';

  const [all, summary] = await Promise.all([listExhibitors(), exhibitorSummary()]);

  /*
   * The state of each stand's lead desk link, and how many people have agreed
   * to be on their list. One read per exhibitor plus one `count()` each — six
   * of them here — on a screen an organizer opens a handful of times before the
   * hall opens. The alternative is a denormalised total with two writers and no
   * transaction between them; see `exhibitor-leads.ts`.
   */
  const links = await leadLinkRows(all.map((e) => e.id));
  const linksOn = leadLinksAvailable();
  const emailOn = leadEmailAvailable();

  const linkTargets: LeadLinkTarget[] = all.map((e) => {
    const row = links[e.id];
    const { state } = leadLinkState({
      issuedAtMs: row?.issuedAtMs,
      sentAtMs: row?.sentAtMs,
      validFromMs: row?.validFrom,
    });
    const leads = `${row?.leadCount ?? 0} lead${(row?.leadCount ?? 0) === 1 ? '' : 's'}`;
    return {
      id: e.id,
      name: e.name,
      hasAddress: Boolean(e.contactEmail),
      cancelled: e.status === 'cancelled',
      /*
       * One label, so the Send list and the Stop list cannot describe the same
       * stand two ways. They used to: Send said "cancelled" where Stop said
       * "not sent", which reads as two screens disagreeing about the same
       * company.
       */
      statusLabel:
        state === 'stopped'
          ? 'stopped'
          : state === 'emailed'
            ? `sent, ${leads}`
            : state === 'issued'
              ? `link ready, not emailed`
              : 'not sent',
    };
  });

  const editingDoc = editId ? await getExhibitor(editId) : null;
  const editing = editingDoc ? all.find((e) => e.id === editingDoc.id) : undefined;
  const showForm = creating || Boolean(editing);

  const q = String(sp.q ?? '').trim().toLowerCase();
  const filtered = all.filter((e) =>
    !q
      ? true
      : [e.name, e.boothNumber, e.contactName, e.contactEmail].some((v) =>
          v.toLowerCase().includes(q),
        ),
  );

  const rows = paginate(
    sortRows(filtered, sort.by, sort.dir, {
      name: (e) => e.name,
      booth: (e) => e.boothNumber || '￿',
      status: (e) => e.status,
      passes: (e) => e.passesUsed,
    }),
    page,
    PER_PAGE,
  );

  return (
    <>
      <PageHeader
        title="Exhibitor Manager"
        tags={<Tag color="blue">{summary.confirmed} confirmed</Tag>}
        actions={
          !showForm ? (
            <Link href="?new=1" className="whova-btn-main primary">
              + Add exhibitor
            </Link>
          ) : (
            <Link href="/content/exhibitor-center/exhibitor-manager" className="whova-btn-main secondary">
              Back to list
            </Link>
          )
        }
        links={[
          <Link key="s" href={ROUTES.sponsorManager}>
            Sponsor Manager
          </Link>,
          <Link key="m" href="/content/exhibitor-center/message-exhibitors">
            Message Exhibitors
          </Link>,
          <Link key="x" href={ROUTES.analyticsExports}>
            Exports
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Exhibitors', value: summary.total, sub: `${summary.provisional} provisional` },
          {
            label: 'Without a booth',
            value: summary.withoutBooth,
            sub: summary.withoutBooth === 0 ? 'all placed' : 'not on the floor plan',
          },
          {
            label: 'Staff passes',
            value: `${summary.passesUsed} / ${summary.passesAllocated}`,
            sub: summary.overAllocated > 0 ? `${summary.overAllocated} over allocation` : 'within allocation',
          },
          {
            label: 'No contact',
            value: summary.withoutContact,
            sub: 'cannot be messaged or sent a lead link',
          },
          {
            label: 'Leads scanned',
            value: totalLeads(links),
            sub: 'attendees who agreed at a stand',
          },
        ]}
      />

      {summary.overAllocated > 0 && (
        <Banner kind="danger">
          <strong>{summary.overAllocated} exhibitor{summary.overAllocated === 1 ? ' has' : 's have'} claimed more staff passes than their package allows.</strong>{' '}
          Settle it with them before doors open.
        </Banner>
      )}

      {showForm ? (
        <Panel>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>
            {editing ? `Edit ${editing.name}` : 'New exhibitor'}
          </h2>
          <ExhibitorForm existing={editing} />
        </Panel>
      ) : (
        <Panel>
          <div style={{ alignItems: 'center', display: 'flex', gap: 12, marginBottom: 12 }}>
            <SearchInput placeholder="Company, booth, contact…" />
          </div>

          {all.length === 0 ? (
            <NotInputted
              what="exhibitors"
              action={
                <Link href="?new=1" className="whova-btn-main secondary">
                  Add the first one
                </Link>
              }
            />
          ) : (
            <>
              <Table
                sort={sort}
                cols={[
                  { key: 'b', label: 'Booth', className: 'cell-xs', sortKey: 'booth' },
                  { key: 'n', label: 'Company', className: 'cell-fill', sortKey: 'name' },
                  { key: 'c', label: 'Contact', className: 'cell-md' },
                  { key: 'p', label: 'Passes', className: 'cell-sm', sortKey: 'passes' },
                  { key: 's', label: 'Status', className: 'cell-sm', sortKey: 'status' },
                  { key: 'a', label: '', className: 'cell-sm' },
                ]}
                rows={rows.map((e) => [
                  e.boothNumber ? (
                    <strong key="b">{e.boothNumber}</strong>
                  ) : (
                    <Tag key="b" color="orange" fill="outline" small>
                      none
                    </Tag>
                  ),
                  <span key="n" style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
                    {/*
                      The logo earns a column of its own here because it is the
                      one field on this screen that can now be wrong in a way
                      nobody notices: an upload that silently did not land looks
                      exactly like an exhibitor who never had a logo. Showing it
                      in the list is the cheapest possible check.
                    */}
                    {e.logoURL ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={e.logoURL}
                        alt=""
                        style={{ flex: '0 0 auto', height: 28, objectFit: 'contain', width: 28 }}
                      />
                    ) : (
                      <span style={{ flex: '0 0 auto', width: 28 }} />
                    )}
                    <span>
                    {e.website ? (
                      <a href={e.website} target="_blank" rel="noreferrer">
                        {e.name}
                      </a>
                    ) : (
                      e.name
                    )}
                    {e.description && (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {e.description.slice(0, 90)}
                        {e.description.length > 90 ? '…' : ''}
                      </div>
                    )}
                    </span>
                  </span>,
                  <span key="c" style={{ fontSize: 12 }}>
                    {e.contactEmail ? (
                      <>
                        {e.contactName || <Email address={e.contactEmail} />}
                        <div className="muted" style={{ fontSize: 11 }}>
                          <Email address={e.contactEmail} />
                        </div>
                      </>
                    ) : (
                      <span className="muted">none on file</span>
                    )}
                  </span>,
                  <span key="p">
                    {typeof e.passesAllocated === 'number' ? (
                      <>
                        <span style={{ fontSize: 13 }}>
                          {e.passesUsed} / {e.passesAllocated}
                        </span>
                        <ProgressBar
                          pct={Math.min(100, (e.passesUsed / Math.max(1, e.passesAllocated)) * 100)}
                        />
                      </>
                    ) : (
                      <span className="muted" style={{ fontSize: 12 }}>
                        not set
                      </span>
                    )}
                  </span>,
                  <Tag
                    key="s"
                    color={e.status === 'confirmed' ? 'green' : e.status === 'cancelled' ? 'red' : 'orange'}
                    fill="outline"
                    small
                  >
                    {e.status}
                  </Tag>,
                  <div key="a" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <Link href={`?edit=${e.id}`} style={{ fontSize: 12 }}>
                      Edit
                    </Link>
                    {/*
                      A form, not a link: cancelling an exhibitor is a write, and
                      a GET that changes state is one prefetch away from taking a
                      paying company off the floor plan.
                    */}
                    <form action={setExhibitorStatusAction}>
                      <input type="hidden" name="id" value={e.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={e.status === 'cancelled' ? 'provisional' : 'cancelled'}
                      />
                      <button
                        type="submit"
                        style={{
                          background: 'none',
                          border: 0,
                          color: e.status === 'cancelled' ? 'var(--link)' : 'var(--danger, #b3352c)',
                          cursor: 'pointer',
                          fontSize: 12,
                          padding: 0,
                        }}
                      >
                        {e.status === 'cancelled' ? 'Reinstate' : 'Cancel'}
                      </button>
                    </form>
                  </div>,
                ])}
              />
              <Pagination total={filtered.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />
            </>
          )}
        </Panel>
      )}

      {!showForm && (
        <Panel style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Lead capture</h2>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
            Each stand gets its own link. Their staff open it on a phone, scan an attendee&rsquo;s
            badge, the attendee agrees on screen to share their name, company, job title and email,
            and the stand can add a note and download their own list as a spreadsheet. A stand sees
            only the people it has scanned. There is no exhibitor login: the link is the access, so
            treat it the way you would treat a password.
          </p>

          {!linksOn ? (
            <Banner kind="warning">
              Links cannot be created on this server yet, so nothing here will open. That is one
              setting on the server, not a change to this screen.
            </Banner>
          ) : (
            <>
              <div className="form-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 32 }}>
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                  <SendLeadLinkForm exhibitors={linkTargets} emailOn={emailOn} />
                </div>
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                  <RevokeLeadLinkForm exhibitors={linkTargets} />
                </div>
              </div>

              <Table
                stackSm
                cols={[
                  { key: 'n', label: 'Company', className: 'cell-fill' },
                  { key: 'l', label: 'Leads', className: 'cell-xs' },
                  { key: 's', label: 'Link', className: 'cell-md' },
                  { key: 'u', label: 'Their address', className: 'cell-fill' },
                ]}
                rows={all
                  .filter((e) => e.status !== 'cancelled')
                  .map((e) => {
                    const row = links[e.id];
                    const { state, showLink } = leadLinkState({
                      issuedAtMs: row?.issuedAtMs,
                      sentAtMs: row?.sentAtMs,
                      validFromMs: row?.validFrom,
                    });
                    return [
                      <span key="n">
                        {e.name}
                        {e.boothNumber ? (
                          <div className="muted" style={{ fontSize: 11 }}>
                            Stand {e.boothNumber}
                          </div>
                        ) : null}
                      </span>,
                      <strong key="l">{row?.leadCount ?? 0}</strong>,
                      <span key="s" style={{ fontSize: 12 }}>
                        {state === 'stopped' ? (
                          <Tag color="red" fill="outline" small>
                            stopped
                          </Tag>
                        ) : state === 'emailed' ? (
                          <>
                            <Tag color="green" fill="outline" small>
                              sent
                            </Tag>
                            <div className="muted" style={{ fontSize: 11 }}>
                              {stampOfMillis(row?.sentAtMs)}
                              {row?.sentTo ? ` to ${row.sentTo}` : ''}
                            </div>
                          </>
                        ) : state === 'issued' ? (
                          <>
                            <Tag color="grey" fill="outline" small>
                              ready
                            </Tag>
                            <div className="muted" style={{ fontSize: 11 }}>
                              {stampOfMillis(row?.issuedAtMs)}, not emailed
                            </div>
                          </>
                        ) : (
                          <span className="muted">not sent</span>
                        )}
                      </span>,
                      /*
                        The live link, printed so it can be sent by hand while
                        email is off — the same thing Speaker Manager does, for
                        the same reason.

                        ⚠️ Not printed for a stopped stand, and that is the whole
                        point of `leadLinkState`. Each render mints a fresh
                        token, and revocation can only refuse tokens minted
                        before it, so a link printed here always opens — beside
                        a "stopped" tag it quietly undoes the revocation for
                        whoever copies it. Sending issues a new link and brings
                        the row back.
                      */
                      showLink ? (
                        <code key="u" style={{ fontSize: 11, overflowWrap: 'anywhere' }}>
                          {leadDeskLink(e.id)}
                        </code>
                      ) : (
                        <span key="u" className="muted" style={{ fontSize: 12 }}>
                          No link works for this stand. Send them one to start again.
                        </span>
                      ),
                    ];
                  })}
              />
            </>
          )}
        </Panel>
      )}

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>An exhibitor portal.</strong> Lead scanning is built, above. What is still
            missing around it is everything else a stand might sign in for: editing their own
            profile, managing staff passes, seeing who visited their page. There is no exhibitor
            login, only the one link per stand.
          </li>
          <li>
            <strong>Exhibitor tickets.</strong> Staff passes would be sold through a parallel
            ticket catalogue. <code>TicketAudience</code> allows for it and no screen builds one, so
            passes here are a number in a contract rather than issued badges.
          </li>
          <li>
            <strong>Booth selection.</strong> An exhibitor picking their own booth needs a floor
            plan. There is none.
          </li>
          <li>
            <strong>Where the logos go.</strong> Uploading one works — this is the first screen in
            the dashboard that writes to Firebase Storage — but nothing outside this dashboard reads{' '}
            <code>exhibitors</code> yet, so the logo is visible here and nowhere else. The website
            and the app have no exhibitor surface at all.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
