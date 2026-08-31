import { useMemo } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { DataError } from '@/components/data-error';
import { EmptyState } from '@/components/empty-state';
import { Chevron } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { PushedHeader } from '@/components/pushed-header';
import { Screen } from '@/components/screen';
import { SkeletonBlock, SkeletonScreen } from '@/components/skeleton';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { isOpen, useAnsweredSurveys, useSurveys } from '@/lib/data/surveys';

/**
 * The surveys an attendee can answer.
 *
 * This tile used to route to `coming-soon` saying surveys were waiting on "the
 * organizer console". The console has authored them since August 2026
 * (`engagement/survey-actions.ts`); the copy was simply stale, which is the
 * defect class `AGENTS.md` records fourteen instances of and the reason this
 * screen reads the same documents the console writes rather than a second shape
 * invented here.
 *
 * ## Closed surveys are listed, not hidden
 *
 * A survey whose window has passed still appears, marked closed. It still
 * opens — the screen behind it shows the questions and says why they cannot be
 * answered, which is a better answer than an inert row. Dropping it altogether
 * would leave somebody who was told "there's a feedback
 * form" looking at a list that does not contain it, with nothing to explain the
 * difference between "closed" and "never existed". The console does not
 * currently write `opensAt` or `closesAt` at all, so in practice every published
 * survey is open — the branch exists because the model has the fields and a
 * screen that ignored them would start lying the day somebody set one.
 */
export default function SurveysScreen() {
  const router = useRouter();
  const { surveys, error, status, retry } = useSurveys();

  const ids = useMemo(() => (surveys ?? []).map((s) => s.id), [surveys]);
  const { answered, checked } = useAnsweredSurveys(ids);

  const now = new Date();

  if (error) {
    return (
      <>
        <PushedHeader backTitle="Home" backHref="/home" />
        <Screen grouped>
          <DataError error={error} subject="the surveys" onRetry={retry} />
        </Screen>
      </>
    );
  }

  if (status === 'loading') {
    return (
      <>
        <PushedHeader backTitle="Home" backHref="/home" />
        <Screen grouped>
          <SkeletonScreen
            label="the surveys"
            slowNotice="Still loading. The app cannot reach the server — this will fill in as soon as it can.">
            <SkeletonBlock width="40%" height={26} />
            <SkeletonBlock height={64} radius={Radius.lg} />
            <SkeletonBlock height={64} radius={Radius.lg} />
          </SkeletonScreen>
        </Screen>
      </>
    );
  }

  const rows = surveys ?? [];

  return (
    <>
      <PushedHeader backTitle="Home" backHref="/home" />

      <Screen grouped>
        <View style={{ gap: Spacing.xs }}>
          <Text variant="title" accessibilityRole="header">
            Surveys
          </Text>
          <Text variant="subhead" tone="secondary">
            Feedback on a session, and the event survey. Your answers go to the
            organizers; nobody else in the app can read them.
          </Text>
        </View>

        {rows.length ? (
          <View style={{ borderRadius: Radius.lg, overflow: 'hidden' }}>
            {rows.map((s, i, arr) => {
              const open = isOpen(s, now);
              const done = answered.has(s.id);
              const count = s.questions?.length ?? 0;
              return (
                <ListRow
                  key={s.id}
                  title={s.title}
                  subtitle={s.description}
                  // Three different facts, and never more than one of them, so
                  // the line cannot say "Answered" about a survey that closed
                  // before this reader opened it.
                  meta={
                    done
                      ? 'Answered'
                      : !open
                        ? 'Closed'
                        : `${count} question${count === 1 ? '' : 's'}`
                  }
                  trailing={<Chevron />}
                  first={i === 0}
                  last={i === arr.length - 1}
                  // Openable either way: a closed or answered survey still shows
                  // its questions, and the screen behind explains which of the
                  // two it is rather than leaving an inert row.
                  onPress={() =>
                    router.push({ pathname: '/home/survey/[id]', params: { id: s.id } })
                  }
                />
              );
            })}
          </View>
        ) : (
          <EmptyState
            icon="square.and.pencil"
            title="No surveys yet"
            message="Feedback forms appear here once the organizers publish them."
          />
        )}

        {/* Whether you have answered is a per-survey point read, and it can fail
            on its own while the list itself loads fine. Saying nothing would show
            every row as unanswered and invite a submission the rules then refuse
            — which reads as the app being broken rather than as the answer
            already being recorded. */}
        {rows.length > 0 && !checked ? (
          <Text variant="caption" tone="tertiary">
            Checking which of these you have already answered.
          </Text>
        ) : null}
      </Screen>
    </>
  );
}
