import type { Metadata } from 'next';
import { EVENT } from '@kgc/shared';
import { RequestForm } from './request-form';

/**
 * `/request` on the dashboard host: ask for a small change, no sign-in (T428).
 *
 * Outside `(dash)`, so its layout's `requireAccess()` never runs, and outside
 * the middleware's matcher. Unlisted: nothing on the website links here, and
 * the page asks search engines not to index it. The organizers read what
 * arrives on Tools › Change requests.
 */
export const metadata: Metadata = {
  title: `Request a change | ${EVENT.shortName}`,
  description: 'Ask for a small change to the Knowledge Graph Conference website.',
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-static';

export default function RequestPage() {
  return (
    <main className="login-shell request-shell">
      <div className="login-card request-card">
        <div className="whova-header__blue-bar" />
        <div className="login-body">
          <RequestForm />
        </div>
      </div>
    </main>
  );
}
