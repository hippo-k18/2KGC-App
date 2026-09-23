import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { leadTimestamp } from '@kgc/shared';
import { listLeads, openLeadDesk } from '@/lib/exhibitor-leads';
import { siteEvent } from '@/lib/data';
import { noteAction } from './actions';
import { ScanDesk } from './scan-desk';

export const metadata: Metadata = {
  title: 'Lead desk',
  // A capability URL. A capability in a search index is a capability anybody
  // can exercise — the same treatment `/order/{token}` and `/u/{token}` get.
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

export const dynamic = 'force-dynamic';

/**
 * `/exhibitor/{token}` — one stand's lead desk.
 *
 * ── What this is, and what it is not ────────────────────────────────────────
 *
 * It is the smallest honest version of lead retrieval: scan a badge, the
 * attendee agrees on screen, add a note, download the list. It is **not** an
 * exhibitor portal. There is no login, no staff management, no profile editing,
 * no floor plan and no messaging, and the page says none of those exist rather
 * than implying they are elsewhere.
 *
 * ── Why the whole list is on the same page as the scanner ───────────────────
 *
 * Because the question a stand asks between conversations is "did that last one
 * save?", and a count is not an answer to it. The list is also the only place
 * the note can be changed afterwards, which is what somebody does at the end of
 * the day.
 *
 * ── The export is a route, not a button that builds a file here ─────────────
 *
 * `/exhibitor/{token}/leads.csv` is a real address, so it survives being opened
 * on a phone and mailed to a laptop, which is what a stand actually does. It
 * carries the same token and makes the same `openLeadDesk` check, so revoking
 * the link stops the download too.
 */
export default async function LeadDeskPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rawToken = decodeURIComponent(token);

  const [grant, ev] = await Promise.all([openLeadDesk(rawToken), siteEvent()]);
  /*
   * One answer for a forged token, an expired one, a revoked one, a company
   * that has come off the floor plan and one from another event. Telling them
   * apart would answer "is this company still exhibiting?" to anybody holding
   * an old URL.
   */
  if (!grant) notFound();

  const leads = (await listLeads(rawToken)) ?? [];
  const csvHref = `/exhibitor/${encodeURIComponent(rawToken)}/leads.csv`;

  return (
    <section>
      <div className="wrap">
        <p className="eyebrow">{ev.shortName}</p>
        <h1>{grant.exhibitor.name}</h1>
        <p className="lede">
          {grant.exhibitor.boothNumber
            ? `Stand ${grant.exhibitor.boothNumber}. `
            : ''}
          Scan an attendee&rsquo;s badge, they agree on screen, and they join your list. You see
          only the people your stand has scanned.
        </p>

        <ScanDesk token={rawToken} exhibitorName={grant.exhibitor.name} />

        <section className="lead-list">
          <div className="lead-list-head">
            <h2>
              Your leads <span className="lead-count">{leads.length}</span>
            </h2>
            {leads.length > 0 && (
              <a className="btn btn-outline btn-sm" href={csvHref}>
                Download as a spreadsheet
              </a>
            )}
          </div>

          {leads.length === 0 ? (
            <p className="lead-muted">
              Nobody yet. The first badge you scan and who agrees appears here.
            </p>
          ) : (
            <ul className="lead-rows">
              {leads.map((lead) => (
                <li key={lead.registrationId}>
                  <div className="lead-who">
                    <b>{lead.name}</b>
                    {(lead.title || lead.company) && (
                      <span>{[lead.title, lead.company].filter(Boolean).join(' · ')}</span>
                    )}
                    <a href={`mailto:${lead.email}`}>{lead.email}</a>
                    <em>{leadTimestamp(lead.scannedAtMs, ev.timeZone)}</em>
                  </div>
                  {/*
                    A plain form per row rather than a client component: one
                    field, one button, and it works on a stand with the worst
                    Wi-Fi in the building and JavaScript still loading.
                  */}
                  <form action={noteAction} className="lead-note-form">
                    <input type="hidden" name="token" value={rawToken} />
                    <input type="hidden" name="registrationId" value={lead.registrationId} />
                    <input
                      type="text"
                      name="note"
                      defaultValue={lead.note ?? ''}
                      maxLength={500}
                      placeholder="Add a note"
                      aria-label={`Note about ${lead.name}`}
                    />
                    <button type="submit" className="btn btn-outline btn-sm">
                      Save
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="lead-muted lead-fine">
          This link is your access. Share it with your stand team and nowhere else. It stops working
          four months after it was sent, and the organizers can stop it sooner. Nobody is added to
          your list unless they tap to agree in front of you, and the wording they agreed to is kept
          with their record.
        </p>
      </div>
    </section>
  );
}
