'use client';

import { useId, useState } from 'react';
import { scheduleProblem } from '@/lib/learn-tools-core';
import { cancelLearnScheduleAction, scheduleLearnPublishAction } from './api';
import { Modal } from './dialogs';
import './extras.css';

const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';

/** "Tue 21 Oct at 9:00 AM", with the year only when it is not this year. */
export function formatScheduled(at: number): string {
  const d = new Date(at);
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const year = d.getFullYear() === new Date().getFullYear() ? '' : ` ${d.getFullYear()}`;
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${weekday} ${d.getDate()} ${month}${year} at ${time}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** The values a date and a time input take, in the browser's own time zone. */
function toInputs(ms: number): { date: string; time: string } {
  const d = new Date(ms);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function tomorrowAtNine(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

/** Local wall time to ms. `new Date('YYYY-MM-DDTHH:mm')` without a zone is read as local, which is what we want. */
function fromInputs(date: string, time: string): number {
  if (!date || !time) return NaN;
  return new Date(`${date}T${time}`).getTime();
}

/** "British Summer Time (Europe/London)", so nobody has to guess which 9:00 it means. */
function timeZoneLabel(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const long = new Intl.DateTimeFormat('en-US', { timeZoneName: 'long' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value;
    return long && zone ? `${long} (${zone.replace(/_/g, ' ')})` : zone || 'your computer’s time zone';
  } catch {
    return 'your computer’s time zone';
  }
}

export function ScheduleDialog({
  scheduledAt,
  onScheduled,
  onCancelled,
  onClose,
}: {
  scheduledAt?: number | null;
  onScheduled: (at: number) => void;
  onCancelled: () => void;
  onClose: () => void;
}) {
  const dateId = useId();
  const timeId = useId();
  const problemId = useId();
  const [initial] = useState(() => toInputs(scheduledAt ?? tomorrowAtNine()));
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState<null | 'schedule' | 'cancel'>(null);
  const [error, setError] = useState<string | null>(null);
  const [zone] = useState(timeZoneLabel);

  const at = fromInputs(date, time);
  // Shown once someone has tried to save, then kept live as they fix it.
  const problem = tried ? scheduleProblem(at, Date.now()) : null;

  const schedule = async () => {
    setTried(true);
    if (scheduleProblem(at, Date.now())) return;
    setBusy('schedule');
    setError(null);
    try {
      const res = await scheduleLearnPublishAction(at);
      if (res.ok) {
        onScheduled(res.scheduledPublishAt);
        onClose();
        return;
      }
      setError(res.error);
    } catch {
      setError(NETWORK_ERROR);
    }
    setBusy(null);
  };

  const cancel = async () => {
    setBusy('cancel');
    setError(null);
    try {
      const res = await cancelLearnScheduleAction();
      if (res.ok) {
        onCancelled();
        onClose();
        return;
      }
      setError(res.error);
    } catch {
      setError(NETWORK_ERROR);
    }
    setBusy(null);
  };

  return (
    <Modal
      title={scheduledAt ? 'Change the schedule' : 'Schedule the publish'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-default" onClick={onClose} disabled={busy !== null}>
            Close
          </button>
          <button type="button" className="whova-btn-main small" onClick={() => void schedule()} disabled={busy !== null}>
            {busy === 'schedule' ? 'Saving...' : scheduledAt ? 'Change the time' : 'Schedule'}
          </button>
        </>
      }
    >
      {scheduledAt ? (
        <div className="le-x-sched-now">
          <p>
            <strong>Scheduled to go live {formatScheduled(scheduledAt)}.</strong>
          </p>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => void cancel()} disabled={busy !== null}>
            {busy === 'cancel' ? 'Cancelling...' : 'Cancel the schedule'}
          </button>
        </div>
      ) : null}

      <p>The draft as it is at that moment goes live. You can keep editing until then.</p>

      <form
        className="le-x-sched-form"
        onSubmit={(e) => {
          e.preventDefault();
          void schedule();
        }}
      >
        <div className="whova-form-group">
          <label className="whova-form-label" htmlFor={dateId}>
            Date
          </label>
          <input
            id={dateId}
            type="date"
            className="whova-text-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? problemId : undefined}
            data-autofocus
          />
        </div>
        <div className="whova-form-group">
          <label className="whova-form-label" htmlFor={timeId}>
            Time
          </label>
          <input
            id={timeId}
            type="time"
            className="whova-text-input"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? problemId : undefined}
          />
        </div>
        {/* A hidden submit, so Enter in either field schedules. */}
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </form>
      <p className="le-muted le-x-sched-zone">Times are in {zone}.</p>

      {problem && (
        <p id={problemId} className="le-x-field-error" role="alert">
          {problem}
        </p>
      )}
      {error && (
        <div className="whova-banner danger" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}

/** A slim line under the top bar while a publish is waiting. */
export function ScheduledBanner({ at, onChange, onCancel }: { at: number; onChange: () => void; onCancel: () => void }) {
  return (
    <div className="le-x-sched-banner" role="status">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
        <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 4v3.2l2 1.3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span>Scheduled to go live {formatScheduled(at)}.</span>
      <button type="button" className="le-x-banner-link" onClick={onChange}>
        Change
      </button>
      <span aria-hidden="true">or</span>
      <button type="button" className="le-x-banner-link" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
