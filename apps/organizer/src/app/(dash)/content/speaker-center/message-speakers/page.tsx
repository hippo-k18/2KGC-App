import { MessageScreen } from '../../../messaging/message-screen';

export const dynamic = 'force-dynamic';

/**
 * Content › Speaker Center › Message Speakers.
 *
 * The whole screen is `MessageScreen` — Whova's Message Speakers and Message
 * Sponsors are the same form over a different audience, and duplicating it
 * would mean two places to fix the day the send guards change.
 *
 * `gaps.ts` listed this as blocked on "an email sender. There is none anywhere
 * in this project yet." That stopped being true when the ticket receipts were
 * built; this is the first thing that dependency unblocked.
 */
export default async function MessageSpeakersPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string }>;
}) {
  return <MessageScreen audienceId="speakers" searchParams={searchParams} />;
}
