import { MessageScreen } from '../../../messaging/message-screen';

export const dynamic = 'force-dynamic';

/**
 * Content › Exhibitor Center › Message Exhibitors.
 *
 * The third rendering of `MessageScreen`, and it was one edit away from working
 * for months: the sender, the segment resolution, the per-recipient `emailLog`
 * write and the sent history were all already shared with Message Speakers and
 * Message Sponsors, and `AudienceId` simply had two values instead of three.
 * That value and its `resolveExhibitors` branch now exist in
 * `src/lib/messaging.ts`, so this file is four lines like its two siblings —
 * which is the point of the audience being data rather than three modules.
 *
 * The one thing this audience does that the other two do not is drop
 * `status: 'cancelled'` before any segment is applied. There is no delete on
 * `exhibitors`, so a company that pulled out is still in the collection, and
 * mailing them a floor-plan briefing for a hall they are not in is the single
 * send here that cannot be explained away afterwards. That exclusion lives in
 * `resolveExhibitors` rather than on this screen so it holds for every segment.
 */
export default async function MessageExhibitorsPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string }>;
}) {
  return <MessageScreen audienceId="exhibitors" searchParams={searchParams} />;
}
