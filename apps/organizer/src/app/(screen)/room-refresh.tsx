'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { tickRoomViewAction } from '../(dash)/engagement/poll-actions';

/**
 * The heartbeat behind a projector page.
 *
 * Every `seconds` it asks the server to republish the count (which the server
 * refuses unless the poll still has live results switched on) and then re-reads
 * the page, so the bars on the wall and the numbers on the phones in the room
 * move together.
 *
 * ── Why a timer here and not a listener ────────────────────────────────────
 *
 * A Firestore listener would be fewer round trips, and this dashboard cannot
 * have one: no Firebase credential of any kind may reach the browser here, so
 * every read is a server component. `router.refresh()` re-runs that server
 * component with the session cookie the page already has, which is the whole
 * mechanism.
 *
 * ── It reports its own failure ─────────────────────────────────────────────
 *
 * A room screen that has quietly stopped updating is worse than one that says
 * it has, because the number on the wall still looks like a live result. A tick
 * that throws — the laptop lost the wifi, the session expired — shows the last
 * time the page did update, and nothing pretends otherwise.
 */
export function RoomRefresh({
  sessionId,
  pollId,
  seconds,
  live,
}: {
  sessionId: string;
  pollId: string;
  seconds: number;
  live: boolean;
}) {
  const router = useRouter();
  const [at, setAt] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        if (live) await tickRoomViewAction(sessionId, pollId);
        if (cancelled) return;
        router.refresh();
        setAt(new Date().toLocaleTimeString('en-GB', { hour12: false }));
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    const timer = setInterval(tick, seconds * 1000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [live, pollId, router, seconds, sessionId]);

  return (
    <span>
      {failed
        ? `Not updating. Last change at ${at ?? 'the time this page opened'}.`
        : at
          ? `Updated ${at}`
          : 'Waiting for the first update'}
    </span>
  );
}
