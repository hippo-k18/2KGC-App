import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { DataErrorBanner } from '@/components/data-error';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { HAIRLINE, HIT_TARGET, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  rankQuestions,
  upvoteScore,
  useAskQuestion,
  useMyUpvotes,
  useQuestions,
  useToggleUpvote,
  useUpvoteCounts,
} from '@/lib/data/qa';

/**
 * Live Q&A on a session.
 *
 * Only approved and answered questions are listed — a new question is filed
 * `pending` and a moderator releases it. That is Whova's model and it is the
 * right one: the alternative is whatever someone types appearing on the screen
 * behind the speaker.
 *
 * The upvote numbers are counted from the `upvotes` subcollection rather than
 * read from the question's trigger-owned `upvoteCount`, which never moves. This
 * used to matter twice over: the number was wrong, and it was also the sort key,
 * so the board's ranking was inert. `rankQuestions` states what the ordering now
 * guarantees.
 */
export function SessionQA({ sessionId }: { sessionId: string }) {
  const colors = useTheme();
  const { questions, loading, error, retry } = useQuestions(sessionId);
  const ask = useAskQuestion(sessionId);
  const toggle = useToggleUpvote(sessionId);
  // Ids come from the listener's own order, not from `ranked`. Ranking reorders
  // this array, and both hooks below key on the ids joined — so feeding them the
  // ranked order makes every re-rank look like a different set of questions and
  // re-runs the reads that produced the ranking.
  const ids = useMemo(() => (questions ?? []).map((q) => q.id), [questions]);
  const { counts, adjust } = useUpvoteCounts(sessionId, ids);
  const ranked = useMemo(() => rankQuestions(questions ?? [], counts), [questions, counts]);
  const { upvoted, mark } = useMyUpvotes(sessionId, ids);

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    const result = await ask(body);
    setBusy(false);
    if (result.ok) {
      setDraft('');
      // Say so plainly. A question that vanishes into moderation with no word
      // reads as a bug, and the attendee asks it again.
      setNotice('Sent to the moderator. It appears here once approved.');
    } else {
      setNotice('Could not send that. Check your connection.');
    }
  }

  async function vote(id: string, on: boolean) {
    mark(id, on);
    const result = await toggle(id, on);
    // The star flips first because that is the reader's own state and has to
    // feel instant; the number follows only once the write has actually landed,
    // so a refused upvote never leaves a total nobody else can see.
    if (!result.ok) mark(id, !on);
    else adjust(id, on ? 1 : -1);
  }

  return (
    <View style={{ gap: Spacing.sm }}>
      <Text variant="heading">Questions</Text>

      <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask a question"
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel="Ask a question"
          multiline
          maxLength={500}
          style={{
            flex: 1,
            backgroundColor: colors.surface,
            borderRadius: Radius.md,
            paddingHorizontal: 12,
            paddingVertical: 10,
            minHeight: 44,
            fontSize: 17,
            color: colors.text,
          }}
        />
        <Pressable
          onPress={submit}
          disabled={busy || !draft.trim()}
          accessibilityRole="button"
          accessibilityLabel="Send question"
          style={{ justifyContent: 'center', opacity: draft.trim() && !busy ? 1 : 0.4 }}>
          <Text variant="heading" tone="tint">
            Ask
          </Text>
        </Pressable>
      </View>

      {notice ? (
        <Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}

      {/* "No questions yet. Be the first." is exactly wrong over a refused read:
          the attendee asks a question the room has already asked, and the
          moderator gets it twice. */}
      {error ? (
        <DataErrorBanner error={error} subject="the questions for this session" onRetry={retry} />
      ) : loading ? null : !questions?.length ? (
        <Text variant="subhead" tone="tertiary">
          No questions yet. Be the first.
        </Text>
      ) : (
        <View style={{ borderRadius: Radius.lg, overflow: 'hidden' }}>
          {ranked.map((q, i) => {
            const mine = upvoted.has(q.id);
            // `undefined` until the count lands. Rendered as a dash, because a
            // zero under the star is a claim about the room.
            const votes = upvoteScore(q, counts);
            const total = votes === undefined ? '' : `, ${votes} total`;
            return (
              <View key={q.id} style={{ backgroundColor: colors.surface }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: Spacing.md,
                    padding: Spacing.md,
                  }}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text>{q.body}</Text>
                    {q.answered ? (
                      <Text variant="caption" tone="tint">
                        Answered
                      </Text>
                    ) : null}
                  </View>

                  <Pressable
                    onPress={() => vote(q.id, !mine)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: mine }}
                    accessibilityLabel={
                      mine ? `Remove your upvote${total}` : `Upvote${total}`
                    }
                    hitSlop={8}
                    style={{ alignItems: 'center', minWidth: HIT_TARGET, gap: Spacing.xs }}>
                    <Icon
                      name={mine ? 'star.fill' : 'star'}
                      color={mine ? colors.tint : colors.textTertiary}
                    />
                    <Text variant="caption" tone={mine ? 'tint' : 'tertiary'}>
                      {votes ?? '—'}
                    </Text>
                  </Pressable>
                </View>
                {i < ranked.length - 1 ? (
                  <View
                    style={{
                      height: HAIRLINE,
                      backgroundColor: colors.separator,
                      marginLeft: Spacing.md,
                      marginRight: Spacing.md,
                    }}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
