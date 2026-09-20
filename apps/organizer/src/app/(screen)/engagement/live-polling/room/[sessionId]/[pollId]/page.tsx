import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrganizer } from '@/lib/auth';
import { getPoll } from '@/lib/polls';
import { RoomRefresh } from '../../../../../room-refresh';

export const dynamic = 'force-dynamic';

/**
 * The poll on the screen at the front of the room.
 *
 * ── Why it is outside the dashboard shell ──────────────────────────────────
 *
 * Everything else in this app renders inside Whova's chrome: a utility bar, an
 * event masthead, a nine-tab strip and a 200px rail. On a projector that is
 * four bands of navigation between the audience and the answer. This page sits
 * in its own route group so the shell's layout does not wrap it, while the URL
 * keeps the `engagement/live-polling` prefix — which is what the role guard
 * reads, so whoever can open Live Polling can open the screen it drives.
 *
 * It is still behind the dashboard sign-in. The room screen is driven from a
 * laptop somebody is already signed in on, and a poll result on a public URL is
 * a result anybody can read before the room does.
 *
 * ── Read from the back row ─────────────────────────────────────────────────
 *
 * Type scales with the viewport rather than sitting at a fixed size: the same
 * URL is a 55" panel at eight metres and a phone in somebody's hand checking
 * the projector before the talk. The bars carry their percentage inside them
 * and the count outside, because a bar with no number on it is a shape.
 */
export default async function PollRoomViewPage({
  params,
}: {
  params: Promise<{ sessionId: string; pollId: string }>;
}) {
  await requireOrganizer();
  const { sessionId, pollId } = await params;
  const poll = await getPoll(sessionId, pollId);
  if (!poll) notFound();

  const leader = Math.max(0, ...poll.options.map((o) => o.votes));

  return (
    <main
      style={{
        background: 'var(--kgc-navy)',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        gap: 'clamp(16px, 3vh, 40px)',
        minHeight: '100vh',
        padding: 'clamp(16px, 4vw, 64px)',
      }}
    >
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ flex: '1 1 320px' }}>
          <p
            style={{
              fontSize: 'clamp(12px, 1.4vw, 20px)',
              letterSpacing: 1,
              margin: 0,
              opacity: 0.7,
              textTransform: 'uppercase',
            }}
          >
            {poll.sessionTitle}
          </p>
          <h1
            style={{
              fontSize: 'clamp(26px, 5vw, 80px)',
              lineHeight: 1.1,
              margin: '8px 0 0',
            }}
          >
            {poll.question}
          </h1>
        </div>
        <div
          style={{
            alignSelf: 'flex-start',
            background: poll.open ? 'var(--kgc-orange)' : 'rgba(255, 255, 255, 0.15)',
            borderRadius: 4,
            color: poll.open ? '#333' : '#fff',
            fontSize: 'clamp(12px, 1.4vw, 20px)',
            fontWeight: 600,
            padding: '6px 14px',
            whiteSpace: 'nowrap',
          }}
        >
          {poll.open ? 'Open for votes' : 'Voting closed'}
        </div>
      </header>

      <ol
        style={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          gap: 'clamp(10px, 2vh, 28px)',
          listStyle: 'none',
          margin: 0,
          padding: 0,
        }}
      >
        {poll.options.map((o) => {
          const pct = poll.actualVotes > 0 ? Math.round((o.votes / poll.actualVotes) * 100) : 0;
          const ahead = o.votes > 0 && o.votes === leader;
          return (
            <li key={o.id}>
              <div
                style={{
                  alignItems: 'baseline',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 12,
                  fontSize: 'clamp(16px, 2.4vw, 38px)',
                  marginBottom: 6,
                }}
              >
                <span style={{ flex: 1 }}>{o.label}</span>
                <strong style={{ opacity: ahead ? 1 : 0.75 }}>
                  {o.votes} {o.votes === 1 ? 'vote' : 'votes'}
                </strong>
              </div>
              {/*
                A minimum width on a bar that has scored nothing would draw a
                sliver for zero, which from the back of a room reads as a vote.
              */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.14)',
                  borderRadius: 4,
                  height: 'clamp(24px, 5vh, 64px)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    alignItems: 'center',
                    background: ahead ? 'var(--kgc-orange)' : 'rgba(255, 255, 255, 0.45)',
                    color: ahead ? '#333' : '#fff',
                    display: 'flex',
                    fontSize: 'clamp(13px, 1.8vw, 28px)',
                    fontWeight: 600,
                    height: '100%',
                    justifyContent: 'flex-end',
                    paddingRight: 10,
                    width: `${pct}%`,
                  }}
                >
                  {pct >= 12 ? `${pct}%` : ''}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <footer
        style={{
          alignItems: 'center',
          borderTop: '1px solid rgba(255, 255, 255, 0.2)',
          display: 'flex',
          flexWrap: 'wrap',
          fontSize: 'clamp(11px, 1.2vw, 17px)',
          gap: 16,
          opacity: 0.75,
          paddingTop: 12,
        }}
      >
        <span>
          {poll.actualVotes} {poll.actualVotes === 1 ? 'vote' : 'votes'} so far
        </span>
        <RoomRefresh
          sessionId={sessionId}
          pollId={pollId}
          seconds={REFRESH_SECONDS}
          live={poll.liveResults}
        />
        <span>
          {poll.liveResults
            ? 'Attendees see this result as it moves.'
            : 'Attendees see the result from the last time you published the count.'}
        </span>
        <span style={{ flex: 1 }} />
        <Link href="/engagement/live-polling" style={{ color: '#fff' }}>
          Back to Live Polling
        </Link>
      </footer>
    </main>
  );
}

/**
 * Five seconds, and the number is a trade rather than a preference.
 *
 * Each tick is one recount of the ballots plus one page render. Faster buys
 * nothing an audience can perceive — a bar moving more often than the eye can
 * follow reads as flicker — and costs a read of every vote document that much
 * more often, which is the load the `tallyPoll` trigger exists to keep off
 * Firestore in the first place.
 */
const REFRESH_SECONDS = 5;
