'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * The error boundary for every screen in the shell.
 *
 * Same reasoning as `not-found.tsx`: it sits in the `(dash)` group so a thrown
 * read paints inside the chrome instead of replacing the whole product with
 * Next's black default page, which looks like the dashboard died rather than
 * like one query failed.
 *
 * It deliberately does **not** import `./ui`. That module is imported by server
 * components and calls `gapNotesVisible()`, which reads a non-`NEXT_PUBLIC_`
 * env var; pulling it into a client bundle would make the flag silently read
 * `false` in the browser and put 400 lines of page furniture in the client
 * chunk. The four classes below are the same ones `PageHeader`, `Panel` and
 * `Banner` render, so the shape matches without the import.
 *
 * Note what this boundary cannot catch: `(dash)/layout.tsx` awaits seven
 * Firestore counts before it paints, and an error boundary never catches its
 * own segment's layout. If Firestore is unreachable entirely, the layout throws
 * above this file. What lands here is the common case — one screen's read
 * failing while the shell is fine.
 */

export default function DashError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server strips the message in production and leaves only `digest`;
    // this is the only place the two are visible together.
    console.error('[dash] screen threw', error);
  }, [error]);

  return (
    <>
      <div className="whova-header">
        <div className="whova-header__blue-bar" />
        <div className="whova-header__container">
          <div className="whova-header__top">
            <span className="whova-header__feature">This screen stopped on a read</span>
          </div>
          <div className="whova-header__bottom">
            <div className="whova-header__link-group">
              <span>
                <Link href="/">My Events</Link>
              </span>
              <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                <span className="whova-header__vertical-bar">|</span>
                <Link href="/tools/report">Report</Link>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="whova-banner danger">
          <div>
            <strong>Nothing was written.</strong> Every screen here reads on the server before it
            paints, so a failed read stops the render rather than showing half a table. The event
            data is untouched.
          </div>
        </div>

        <dl className="gap-grid">
          <dt>What failed</dt>
          <dd>{error.message || 'The server did not return a message for this one.'}</dd>
          {error.digest ? (
            <>
              <dt>Digest</dt>
              <dd>
                <code>{error.digest}</code> — the id to grep for in the server log.
              </dd>
            </>
          ) : null}
          <dt>Usual causes</dt>
          <dd>
            The Firestore emulator is not running (<code>npm run dev:emulators</code> at the repo
            root, then <code>npm run seed</code>), or the query needs a composite index that is not
            in <code>firestore.indexes.json</code>. The emulator does not enforce indexes, so that
            second one only ever appears against the live project.
          </dd>
          <dt>Next</dt>
          <dd>
            Retry re-runs this screen&apos;s reads without reloading the shell. If it fails the same
            way twice, the data is the problem, not the request.
          </dd>
        </dl>

        <div className="toolbar" style={{ marginBottom: 0, marginTop: 20 }}>
          <button type="button" className="whova-btn-main primary" onClick={reset}>
            Retry this screen
          </button>
          <Link className="whova-btn-main secondary" href="/">
            Back to My Events
          </Link>
        </div>
      </div>
    </>
  );
}
