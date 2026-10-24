'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { revertLearnDraftAction, type LearnVersionSummary } from './api';
import { HistoryDialog } from './dialogs';
import './editor.css';

/**
 * What Content › Learn page shows when the stored draft cannot be read (T320).
 *
 * Both ways out go through the same actions as the editor's own buttons, and
 * both write validated content: Discard puts back the published copy (or the
 * built-in page if that is unreadable too), Restore copies a published
 * version in. Either way the page then reloads into the normal editor.
 */
export function UnreadableDraft({
  problems,
  versions,
  siteOrigin,
}: {
  problems: string[];
  versions: LearnVersionSummary[];
  siteOrigin: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState(false);

  const discard = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await revertLearnDraftAction();
      if (!res.ok) setError(res.error);
      else router.refresh();
    } catch {
      setError('Could not discard the draft. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, padding: '32px 16px' }}>
      <h1>This draft could not be read.</h1>
      <p>
        The saved draft of the Learn page is not in a shape the editor can open. The website is not affected: it
        still shows the published page.
      </p>
      <p>Discard the draft to start again from the published page, or restore one of the published versions.</p>
      {problems.length > 0 && (
        <details>
          <summary>What is wrong with it</summary>
          <ul>
            {problems.slice(0, 10).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </details>
      )}
      {error && (
        <div className="whova-banner danger" role="alert">
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void discard()}>
          {busy ? 'Discarding...' : 'Discard the draft'}
        </button>
        <button
          type="button"
          className="btn btn-default"
          disabled={busy || versions.length === 0}
          onClick={() => setHistory(true)}
        >
          Restore a version
        </button>
      </div>
      {versions.length === 0 && <p className="le-muted">Nothing has been published from here yet, so there is no version to restore.</p>}
      {history && (
        <HistoryDialog
          versions={versions}
          siteOrigin={siteOrigin}
          onRestored={() => router.refresh()}
          onClose={() => setHistory(false)}
        />
      )}
    </div>
  );
}
