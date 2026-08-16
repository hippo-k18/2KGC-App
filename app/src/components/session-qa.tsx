import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { HAIRLINE, HIT_TARGET, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  useAskQuestion,
  useMyUpvotes,
  useQuestions,
  useToggleUpvote,
} from '@/lib/data/qa';

/**
 * Live Q&A on a session.
 *
 * Only approved and answered questions are listed — a new question is filed
 * `pending` and a moderator releases it. That is Whova's model and it is the
 * right one: the alternative is whatever someone types appearing on the screen
 * behind the speaker.
 *
 * The upvote count is trigger-owned, so it does not move the instant you tap.
 * The button reflects your own vote immediately from local state, which is the
 * part that has to feel instant; the number catching up a moment later is
 * honest rather than laggy.
 */
export function SessionQA({ sessionId }: { sessionId: string }) {
  const colors = useTheme();
  const { questions, loading } = useQuestions(sessionId);
  const ask = useAskQuestion(sessionId);
  const toggle = useToggleUpvote(sessionId);
  const { upvoted, mark } = useMyUpvotes(sessionId, (questions ?? []).map((q) => q.id));

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
    if (!result.ok) mark(id, !on);
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

      {loading ? null : !questions?.length ? (
        <Text variant="subhead" tone="tertiary">
          No questions yet. Be the first.
        </Text>
      ) : (
        <View style={{ borderRadius: Radius.lg, overflow: 'hidden' }}>
          {questions.map((q, i) => {
            const mine = upvoted.has(q.id);
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
                      mine
                        ? `Remove your upvote, ${q.upvoteCount ?? 0} total`
                        : `Upvote, ${q.upvoteCount ?? 0} total`
                    }
                    hitSlop={8}
                    style={{ alignItems: 'center', minWidth: HIT_TARGET, gap: Spacing.xs }}>
                    <Icon
                      name={mine ? 'star.fill' : 'star'}
                      color={mine ? colors.tint : colors.textTertiary}
                    />
                    <Text variant="caption" tone={mine ? 'tint' : 'tertiary'}>
                      {q.upvoteCount ?? 0}
                    </Text>
                  </Pressable>
                </View>
                {i < questions.length - 1 ? (
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
