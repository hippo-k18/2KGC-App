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
          <p>Answers are anonymous.</p>
        </>
      }
      searchParams={searchParams}
    />
  );
}
