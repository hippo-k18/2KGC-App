import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { DataErrorBanner } from '@/components/data-error';
import { Text } from '@/components/text';
import { HAIRLINE, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { failureCode } from '@/lib/data/errors';
import { tallyState, useCastVote, useMyVote, usePolls } from '@/lib/data/qa';

/**
 * Live polling on a session.
 *
 * Results are shown only after you have voted, which is the convention Slido and
 * Mentimeter both use — seeing the running tally first anchors the answer.
 *
 * The bars come from the trigger-owned `tallies`, and they are drawn only when
 * that tally can be shown to include the reader's own ballot. The reasoning, and
 * why this screen cannot simply count the votes the way the organizer dashboard
 * does, is in `tallyState` — it is the difference between the organizer and the
 * attendee seeing the same poll and seeing two different numbers.
 */
export function SessionPoll({ sessionId }: { sessionId: string }) {
  const { polls, error, retry } = usePolls(sessionId);
  const poll = polls[0];
  // A refused read used to render nothing whatsoever — the section simply was not
  // there — so an attendee looking for the poll the speaker had just opened
  // concluded there was not one. Silence is not an acceptable answer here.
  if (error) {
    return (
      <DataErrorBanner error={error} subject="the poll for this session" onRetry={retry} />
    );
  }
  if (!poll) return null;
  return <Poll sessionId={sessionId} pollId={poll.id} poll={poll} />;
}

function Poll({
  sessionId,
  pollId,
  poll,
}: {
  sessionId: string;
  pollId: string;
  poll: ReturnType<typeof usePolls>['polls'][number];
}) {
  const colors = useTheme();
  const { vote: myVote, error: voteError } = useMyVote(sessionId, pollId);
  const cast = useCastVote(sessionId, pollId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const voted = Boolean(myVote);
  const total = poll.totalVotes ?? 0;
  // Not `total > 0`. A stored total is a number whether or not anything has
  // counted the ballots, and printing it beside a live audience is the defect
  // this codebase has fourteen recorded cases of.
  const counted = tallyState(poll, myVote);
  const tallied = counted === 'current' && total > 0;

  async function choose(optionId: string) {
    if (!poll.open || busy) return;
    setBusy(true);
    setError(null);
    const result = await cast([optionId]);
    setBusy(false);
    if (!result.ok) setError('Could not record your vote. Try again.');
  }

  return (
    <View style={{ gap: Spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
        <Text variant="heading" style={{ flex: 1 }}>
          {poll.question}
        </Text>
        {!poll.open ? (
          <Text variant="label" tone="tertiary">
            CLOSED
          </Text>
        ) : null}
      </View>

      <View style={{ borderRadius: Radius.lg, overflow: 'hidden' }}>
        {poll.options.map((opt, i) => {
          const chosen = myVote?.optionIds?.includes(opt.id) ?? false;
          const count = poll.tallies?.[opt.id] ?? 0;
          const share = tallied ? count / total : 0;

          return (
            <View key={opt.id} style={{ backgroundColor: colors.surface }}>
              <Pressable
                onPress={() => choose(opt.id)}
                disabled={!poll.open || busy}
                accessibilityRole="button"
                accessibilityState={{ selected: chosen, disabled: !poll.open }}
                accessibilityLabel={
                  // This label used to announce the stored tally whether or not
                  // the row beside it was showing "—" instead of a share, which
                  // told the one reader who cannot see the dash the number the
                  // dash exists to withhold.
                  voted && tallied
                    ? `${opt.label}, ${count} ${count === 1 ? 'vote' : 'votes'}${chosen ? ', your choice' : ''}`
                    : voted
                      ? `${opt.label}${chosen ? ', your choice' : ''}`
                      : `Vote for ${opt.label}`
                }
                style={({ pressed }) => ({
                  padding: Spacing.md,
                  minHeight: 48,
                  justifyContent: 'center',
                  backgroundColor: pressed ? colors.surfacePressed : 'transparent',
                })}>
                {/* The result bar sits behind the label rather than beside it,
                    so the row stays one tap target at any type size. */}
                {voted && tallied ? (
                  <View
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${Math.round(share * 100)}%`,
                      backgroundColor: colors.tintSoft,
                    }}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  />
                ) : null}

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                  <Text style={{ flex: 1 }} tone={chosen ? 'tint' : 'primary'}>
                    {chosen ? '✓ ' : ''}
                    {opt.label}
                  </Text>
                  {voted ? (
                    <Text variant="subhead" tone="secondary">
                      {tallied ? `${Math.round(share * 100)}%` : '—'}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
              {i < poll.options.length - 1 ? (
                <View
                  style={{
                    height: HAIRLINE,
                    backgroundColor: colors.separator,
                    marginHorizontal: Spacing.md,
                  }}
                />
              ) : null}
            </View>
          );
        })}
      </View>

      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      {/* Whether you have voted is read from your own ballot document, so a
          refused read of it re-offers the vote to someone who has already cast
          one — and Firestore rejects the second write, which looks like the poll
          is broken. Said plainly instead. */}
      {voteError ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          Could not check whether you have already voted ({failureCode(voteError) || 'unknown'}).
          If your vote does not register, it is probably already recorded.
        </Text>
      ) : null}

      {/* Two different facts, said as two different sentences. "Counting is
          switched on" was one message for both, and it reads as a promise on the
          poll where nothing will ever count the ballots. */}
      {voted && counted === 'never-counted' ? (
        <Text variant="caption" tone="tertiary">
          Your vote is recorded. The ballots for this poll have not been counted,
          so there is no result to show.
        </Text>
      ) : voted && !tallied ? (
        <Text variant="caption" tone="tertiary">
          Your vote is recorded. Results appear once the count catches up.
        </Text>
      ) : voted ? (
        <Text variant="caption" tone="tertiary">
          {total} {total === 1 ? 'vote' : 'votes'}
        </Text>
      ) : poll.open ? (
        <Text variant="caption" tone="tertiary">
          Results appear after you vote.
        </Text>
      ) : null}
    </View>
  );
}
