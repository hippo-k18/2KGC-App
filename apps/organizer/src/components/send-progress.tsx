'use client';

import { useEffect, useState } from 'react';
import { readSendJobAction } from '@/app/(dash)/send-job-actions';
import type { SendJobView } from '@/lib/send-jobs';

/**
 * The live line under a bulk send: "Sending to speakers: 120 of 400 sent so
 * far." Polls the job every three seconds while it runs and stops when it ends.
 *
 * The send runs on the server whether or not this is open. Closing the tab
 * stops the polling, not the mail.
 */
export function SendProgress({ campaignId, initial }: { campaignId: string; initial?: SendJobView | null }) {
  const [job, setJob] = useState<SendJobView | null>(initial ?? null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const next = await readSendJobAction(campaignId).catch(() => null);
      if (stop) return;
      if (next) setJob(next);
      if (!next || next.view === 'running') timer = setTimeout(tick, 3_000);
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [campaignId]);

  if (!job) return <p className="muted">Starting the send…</p>;

  const pct = job.total ? Math.round(((job.alreadySent + job.sent + job.failed) / job.total) * 100) : 100;
  const cls = job.view === 'done' && job.failed === 0 ? 'ok' : job.view === 'running' ? 'muted' : 'error';

  return (
    <div role="status" aria-live="polite" style={{ margin: '0 0 14px' }}>
      <p className={cls} style={{ marginBottom: 6 }}>
        <strong>{job.subject}</strong>: {job.summary}
      </p>
      {job.view === 'running' && (
        <div style={{ background: 'var(--hairline)', borderRadius: 3, height: 6, maxWidth: 360 }}>
          <div style={{ background: '#2180b2', borderRadius: 3, height: 6, width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
