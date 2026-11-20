import type { Metadata } from 'next';
import { EVENT, TIME_ZONE } from '@kgc/shared';
import { publicSentDate } from '@/lib/change-requests-core';
import { listPublicChangeRequests } from '@/lib/change-requests';
import { ChangeStatusTag } from '../(dash)/tools/change-requests/status-tag';
import { RequestForm } from './request-form';

/**
 * `/request` on the dashboard host: ask for a small change, no sign-in (T428),
 * and see what has been asked for so far (T433). On a wide screen the list
 * sits beside the form and scrolls on its own; below 900px it follows the
 * form (T436).
 *
 * Outside `(dash)`, so its layout's `requireAccess()` never runs, and outside
 * the middleware's matcher. Unlisted: nothing on the website links here, and
 * the page asks search engines not to index it. The organizers read what
 * arrives on Tools › Change requests.
 *
 * Rendered per request, but the list comes from a cache that reads Firestore
 * at most once a minute (`listPublicChangeRequests`), so reloading the page
 * cannot hammer the database. Nothing is read at build time.
 */
export const metadata: Metadata = {
  title: `Request a change | ${EVENT.shortName}`,
  description: 'Ask for a small change to the Knowledge Graph Conference website.',
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

export default async function RequestPage() {
  const requests = await listPublicChangeRequests();
  return (
    <main className="login-shell request-shell">
      <div className="request-layout">
        <div className="login-card request-card request-form-card">
          <div className="whova-header__blue-bar" />
          <div className="login-body">
            <RequestForm />
          </div>
        </div>

        <section className="login-card request-card request-list" aria-labelledby="requests-heading">
          <div className="whova-header__blue-bar" />
          <div className="login-body">
            <h2 id="requests-heading" className="request-list-title">
              Requests
            </h2>
            {requests === null ? (
              <p className="body-2 request-list-empty">The list could not be loaded just now. Reload the page to try again.</p>
            ) : requests.length === 0 ? (
              <p className="body-2 request-list-empty">No requests so far</p>
            ) : (
              <ol className="request-list-items">
                {requests.map((r) => (
                  <li key={r.id}>
                    <p className="request-list-summary">{r.summary}</p>
                    <p className="request-list-meta">
                      <ChangeStatusTag status={r.status} />
                      <time dateTime={new Date(r.sentMs).toISOString()}>Sent {publicSentDate(r.sentMs, TIME_ZONE)}</time>
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
