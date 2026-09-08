import { SurveyScreen } from '../survey-screen';

export const dynamic = 'force-dynamic';

/**
 * Engagement › Session Feedback.
 *
 * The same machinery as Surveys, filtered to those attached to a session. This
 * is the one that decides next year's programme, which is why it gets its own
 * screen rather than being a filter on the other.
 */
export default async function SessionFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; new?: string; results?: string }>;
}) {
  return (
    <SurveyScreen
      mode="session"
      title="Session Feedback"
      info={
        <>
          <strong>Feedback on one session</strong>
          <p>
            Three questions is the right length. A rating, a match-to-description, and one free-text
            box, which is where everything useful comes from.
          </p>
          <p>
            Answers are never attributed, and the app has no screen that renders a survey yet, so a
            published one is not yet answerable from a phone.
          </p>
        </>
      }
      searchParams={searchParams}
    />
  );
}
