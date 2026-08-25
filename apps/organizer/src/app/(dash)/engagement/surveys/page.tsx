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
      intro="Event-wide surveys — the post-conference one, or anything asked of everybody. A survey attached to a session appears under Session Feedback instead."
      searchParams={searchParams}
    />
  );
}
