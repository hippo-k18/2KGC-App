import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/text';
import { HAIRLINE, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCastVote, useMyVote, usePolls } from '@/lib/data/qa';

/**
 * Live polling on a session.
 *
 * Results are shown only after you have voted, which is the convention Slido and
 * Mentimeter both use — seeing the running tally first anchors the answer.
 *
 * The bars come from the trigger-owned `tallies`, so on a Spark project (where
 * no trigger exists) they stay at zero and the screen says so rather than
 * drawing empty bars and letting the organizer conclude nobody voted.
 */
export function SessionPoll({ sessionId }: { sessionId: string }) {
  const { polls } = usePolls(sessionId);
  const poll = polls[0];
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
  const myVote = useMyVote(sessionId, pollId);
  const cast = useCastVote(sessionId, pollId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const voted = Boolean(myVote);
  const total = poll.totalVotes ?? 0;
  const tallied = total > 0;

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
                  voted
                    ? `${opt.label}, ${count} ${count === 1 ? 'vote' : 'votes'}${chosen ? ', your choice' : ''}`
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

      {voted && !tallied ? (
        <Text variant="caption" tone="tertiary">
          Your vote is recorded. Results appear once counting is switched on.
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
