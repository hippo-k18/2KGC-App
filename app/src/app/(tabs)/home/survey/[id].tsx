import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import type { SurveyDoc } from '@kgc/shared';

import { DataError } from '@/components/data-error';
import { EmptyState } from '@/components/empty-state';
import { PushedHeader } from '@/components/pushed-header';
import { Screen } from '@/components/screen';
import { SkeletonBlock, SkeletonScreen } from '@/components/skeleton';
import { Text } from '@/components/text';
import { HAIRLINE, HIT_TARGET, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { failureCode } from '@/lib/data/errors';
import {
  answeredCount,
  decodeMulti,
  encodeMulti,
  isOpen,
  missingRequired,
  RATING_MAX,
  useMySurveyResponse,
  useSubmitSurveyResponse,
  useSurvey,
  type Answers,
  type Survey,
} from '@/lib/data/surveys';

type Question = SurveyDoc['questions'][number];

const BUTTON_HEIGHT = 50;
const COMMENT_MIN_HEIGHT = 88;
const COMMENT_MAX_LENGTH = 1000;

/**
 * Answering one survey.
 *
 * ## Answering twice is refused by the rules, not by this screen
 *
 * `surveys/{id}/responses/{uid}` is keyed by uid and its `update` is closed, so
 * a second submission fails at the security boundary however it is issued. What
 * this screen does is read that document first and show the answers back
 * instead of the form — a courtesy, not the guarantee. The distinction matters
 * because the read can fail on its own: when it does, the form is still offered
 * and the message below says plainly that a refusal probably means the answer is
 * already recorded, rather than letting the attendee conclude the app is broken.
 * That is the wording `session-poll.tsx` settled on for the same situation.
 *
 * ## The question kinds are the console's four, and nothing more
 *
 * `rating`, `single`, `multi`, `text` — parsed out of the console's textarea in
 * `engagement/survey-actions.ts`. A rating is stored as a number 1–5, because
 * the console averages it and prints "out of 5"; a multi-select is stored as its
 * chosen labels joined with `"; "`, because the console splits stored answers on
 * `;` to build the distribution table. Both of those are the console's
 * arithmetic, not a shape invented here, and getting either wrong produces a
 * dashboard of zeros beside a response count that is not zero.
 */
export default function SurveyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { survey, error, status, retry } = useSurvey(id);

  const header = <PushedHeader backTitle="Surveys" backHref="/home/surveys" />;
  const missing = status === 'ready' && !survey;

  if (error) {
    return (
      <>
        {header}
        <Screen grouped>
          <DataError error={error} subject="this survey" onRetry={retry} />
        </Screen>
      </>
    );
  }

  if (missing) {
    return (
      <>
        {header}
        <Screen grouped>
          <EmptyState
            icon="square.and.pencil"
            title="Survey not found"
            // Unpublishing is what removes a survey from the app — the rules
            // stop serving anything but `published` — so "withdrawn" is the
            // honest word rather than "deleted".
            message="This survey is no longer open, or it has been withdrawn."
          />
        </Screen>
      </>
    );
  }

  if (!survey) {
    return (
      <>
        {header}
        <Screen grouped>
          <SkeletonScreen
            label="this survey"
            slowNotice="Still loading. The app cannot reach the server — this will fill in as soon as it can.">
            <SkeletonBlock width="60%" height={26} />
            <SkeletonBlock height={70} radius={Radius.lg} />
            <SkeletonBlock height={70} radius={Radius.lg} />
            <SkeletonBlock height={BUTTON_HEIGHT} radius={Radius.md} />
          </SkeletonScreen>
        </Screen>
      </>
    );
  }

  return (
    <>
      {header}
      <SurveyForm survey={survey} />
    </>
  );
}

function SurveyForm({ survey }: { survey: Survey }) {
  const colors = useTheme();
  const { response, error: responseError } = useMySurveyResponse(survey.id);
  const submit = useSubmitSurveyResponse(survey);

  const [answers, setAnswers] = useState<Answers>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const open = isOpen(survey, new Date());
  const questions = survey.questions ?? [];
  // Either the response document that was read back, or the one just written —
  // the listener refreshes on its own, but not before the button has finished
  // animating, and a form that stays on screen for a second after a successful
  // submit invites a second tap the rules will refuse.
  const done = Boolean(response) || submitted;
  const shown = response?.answers ?? answers;

  const missing = useMemo(() => missingRequired(survey, answers), [survey, answers]);
  const answered = answeredCount(survey, answers);

  function set(questionId: string, value: string | number | undefined) {
    setAnswers((prev) => {
      const next = { ...prev };
      if (value === undefined || value === '') delete next[questionId];
      else next[questionId] = value;
      return next;
    });
  }

  // Nothing to send is not the same as a finished form. Every question the
  // console writes is optional, so without this an empty submission is
  // permitted — and because `update` is closed, that empty response is the one
  // the organizer gets, permanently, from somebody who meant to answer.
  const sendable = missing.length === 0 && answered > 0;

  async function send() {
    if (busy || !sendable) return;
    setBusy(true);
    setFailure(null);
    const result = await submit(answers);
    setBusy(false);
    if (result.ok) {
      setSubmitted(true);
      return;
    }
    // `permission-denied` here has one likely cause and it is not a bug: the
    // response document already exists and `update` is closed. Naming it beats
    // "could not save", which sends somebody to the help desk over an answer
    // that is already recorded.
    setFailure(
      failureCode(result.error) === 'permission-denied'
        ? 'This survey would not take a second set of answers. Yours are probably already recorded.'
        : 'Could not send your answers. Try again.',
    );
  }

  return (
    <Screen grouped>
      <View style={{ gap: Spacing.xs }}>
        <Text variant="title" accessibilityRole="header">
          {survey.title}
        </Text>
        {survey.description ? (
          <Text variant="subhead" tone="secondary">
            {survey.description}
          </Text>
        ) : null}
      </View>

      {done ? (
        <View
          style={{
            backgroundColor: colors.tintSoft,
            borderRadius: Radius.md,
            padding: Spacing.md,
          }}>
          <Text variant="heading">Answered</Text>
          <Text variant="subhead" tone="secondary">
            Thank you. Your answers are below, and they cannot be changed — the
            organizers have them as they were given.
          </Text>
        </View>
      ) : !open ? (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: Radius.md,
            padding: Spacing.md,
          }}>
          <Text variant="heading">Closed</Text>
          <Text variant="subhead" tone="secondary">
            This survey is no longer taking answers. The questions are below.
          </Text>
        </View>
      ) : null}

      <View style={{ gap: Spacing.md }}>
        {questions.map((q, i) => (
          <QuestionBlock
            key={q.id}
            index={i + 1}
            question={q}
            value={shown[q.id]}
            readOnly={done || !open}
            onChange={(v) => set(q.id, v)}
          />
        ))}
      </View>

      {!done && open ? (
        <>
          <Pressable
            onPress={send}
            disabled={busy || !sendable}
            accessibilityRole="button"
            accessibilityLabel={`Send my answers to ${survey.title}`}
            accessibilityState={{ disabled: busy || !sendable }}
            style={({ pressed }) => ({
              backgroundColor: colors.accent,
              opacity: busy || !sendable ? 0.4 : pressed ? 0.85 : 1,
              borderRadius: Radius.md,
              height: BUTTON_HEIGHT,
              alignItems: 'center',
              justifyContent: 'center',
            })}>
            <Text variant="heading" tone="onAccent">
              {busy ? 'Sending…' : 'Send my answers'}
            </Text>
          </Pressable>

          {/* The count is the only thing on screen that says a partly-filled
              form is allowed. Every question the console writes is optional, so
              without it the button reads as refusing an incomplete form — and
              the sentence has to change again at zero, where the button really
              is refusing. */}
          <Text variant="caption" tone="tertiary">
            {missing.length
              ? `${missing.length} required question${missing.length === 1 ? '' : 's'} still to answer.`
              : answered === 0
                ? 'Answer at least one question. You cannot change it afterwards.'
                : `${answered} of ${questions.length} answered. You can send it as it is, ` +
                  'and you cannot change it afterwards.'}
          </Text>
        </>
      ) : null}

      {failure ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {failure}
        </Text>
      ) : null}

      {/* See the screen docblock: this read is how "you have already answered"
          is known, so a refusal has to be said out loud rather than silently
          re-offering the form. */}
      {responseError ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          Could not check whether you have already answered this (
          {failureCode(responseError) || 'unknown'}). If sending is refused, your
          answers are probably already recorded.
        </Text>
      ) : null}
    </Screen>
  );
}

function QuestionBlock({
  index,
  question,
  value,
  readOnly,
  onChange,
}: {
  index: number;
  question: Question;
  value: string | number | undefined;
  readOnly: boolean;
  onChange: (value: string | number | undefined) => void;
}) {
  const colors = useTheme();

  return (
    <View style={{ gap: Spacing.sm }}>
      <Text variant="heading">
        {index}. {question.prompt}
        {question.required ? ' *' : ''}
      </Text>

      {question.kind === 'rating' ? (
        <Rating value={typeof value === 'number' ? value : undefined} readOnly={readOnly} onChange={onChange} />
      ) : question.kind === 'text' ? (
        readOnly ? (
          <Text tone={value ? 'primary' : 'tertiary'}>
            {typeof value === 'string' && value ? value : 'No answer'}
          </Text>
        ) : (
          <TextInput
            value={typeof value === 'string' ? value : ''}
            onChangeText={(t) => onChange(t)}
            placeholder="Your answer"
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel={question.prompt}
            multiline
            maxLength={COMMENT_MAX_LENGTH}
            style={{
              backgroundColor: colors.surface,
              borderRadius: Radius.md,
              paddingHorizontal: 12,
              paddingVertical: 10,
              minHeight: COMMENT_MIN_HEIGHT,
              fontSize: 17,
              color: colors.text,
              textAlignVertical: 'top',
            }}
          />
        )
      ) : (
        <Choices question={question} value={value} readOnly={readOnly} onChange={onChange} />
      )}
    </View>
  );
}

/**
 * A 1–5 scale.
 *
 * Five plain numbered targets rather than stars: the console renders the mean as
 * "4.2 out of 5", and a row of stars invites reading the answer as a rating of
 * the app rather than of the session. Each is a full 44pt target — this is the
 * control most people will use on the way out of a room, one-handed.
 */
function Rating({
  value,
  readOnly,
  onChange,
}: {
  value: number | undefined;
  readOnly: boolean;
  onChange: (value: number | undefined) => void;
}) {
  const colors = useTheme();

  return (
    <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
      {Array.from({ length: RATING_MAX }, (_, i) => i + 1).map((n) => {
        const chosen = value === n;
        return (
          <Pressable
            key={n}
            onPress={() => !readOnly && onChange(chosen ? undefined : n)}
            disabled={readOnly}
            accessibilityRole="radio"
            accessibilityState={{ selected: chosen, disabled: readOnly }}
            accessibilityLabel={`${n} out of ${RATING_MAX}`}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: HIT_TARGET,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: Radius.md,
              borderWidth: HAIRLINE,
              borderColor: chosen ? colors.accent : colors.border,
              backgroundColor: chosen
                ? colors.accent
                : pressed
                  ? colors.surfacePressed
                  : colors.surface,
              // Read-only and unchosen must not look merely pressed: a submitted
              // 4 out of 5 should show the 4 at full strength and the rest dimmed.
              opacity: readOnly && !chosen ? 0.5 : 1,
            })}>
            <Text variant="heading" tone={chosen ? 'onAccent' : 'primary'}>
              {n}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** `single` and `multi`, which differ only in whether a second tap clears the first. */
function Choices({
  question,
  value,
  readOnly,
  onChange,
}: {
  question: Question;
  value: string | number | undefined;
  readOnly: boolean;
  onChange: (value: string | undefined) => void;
}) {
  const colors = useTheme();
  const options = question.options ?? [];
  const multi = question.kind === 'multi';
  const chosen = useMemo(
    () => new Set(multi ? decodeMulti(value) : value === undefined ? [] : [String(value)]),
    [multi, value],
  );

  function toggle(option: string) {
    if (readOnly) return;
    if (!multi) {
      onChange(chosen.has(option) ? undefined : option);
      return;
    }
    const next = new Set(chosen);
    if (next.has(option)) next.delete(option);
    else next.add(option);
    const encoded = encodeMulti(options, next);
    onChange(encoded === '' ? undefined : encoded);
  }

  return (
    <View style={{ borderRadius: Radius.lg, overflow: 'hidden' }}>
      {options.map((option, i) => {
        const on = chosen.has(option);
        return (
          <View key={option} style={{ backgroundColor: colors.surface }}>
            <Pressable
              onPress={() => toggle(option)}
              disabled={readOnly}
              accessibilityRole={multi ? 'checkbox' : 'radio'}
              accessibilityState={{ checked: on, selected: on, disabled: readOnly }}
              accessibilityLabel={option}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: Spacing.sm,
                padding: Spacing.md,
                minHeight: HIT_TARGET,
                backgroundColor: pressed && !readOnly ? colors.surfacePressed : 'transparent',
                opacity: readOnly && !on ? 0.5 : 1,
              })}>
              <Text tone={on ? 'tint' : 'primary'} style={{ flex: 1 }}>
                {on ? '✓ ' : ''}
                {option}
              </Text>
            </Pressable>
            {i < options.length - 1 ? (
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
  );
}
