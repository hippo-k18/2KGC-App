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
            Keep it to about three questions: a rating, whether the session matched its
            description, and one free-text box.
          </p>
          <p>Answers are anonymous.</p>
        </>
      }
      searchParams={searchParams}
    />
  );
}
