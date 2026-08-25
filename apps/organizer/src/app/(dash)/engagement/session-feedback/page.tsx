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
      intro="Feedback attached to a specific session. Three questions is the right length — a rating, a match-to-description, and one free-text box — and the free-text box is where everything useful comes from."
      searchParams={searchParams}
    />
  );
}
