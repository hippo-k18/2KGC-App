import { SurveyScreen } from '../survey-screen';

export const dynamic = 'force-dynamic';

/** Engagement › Surveys — event-wide, not attached to a session. */
export default async function SurveysPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; new?: string; results?: string }>;
}) {
  return (
    <SurveyScreen
      mode="event"
      title="Surveys"
      info={
        <>
          <strong>Event-wide surveys</strong>
          <p>
            Asked of everybody. One attached to a session appears under Session Feedback instead.
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
