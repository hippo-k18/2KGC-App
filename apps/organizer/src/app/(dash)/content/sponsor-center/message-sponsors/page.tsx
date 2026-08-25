import { MessageScreen } from '../../../messaging/message-screen';

export const dynamic = 'force-dynamic';

/**
 * Content › Sponsor Center › Message Sponsors.
 *
 * Same component as Message Speakers over a different audience. The sponsor
 * audience reads `SponsorDoc.contactEmail`, which did not exist until this
 * screen needed it — the sponsor record described a logo rather than a
 * relationship, and chasing a missing logo is the commonest reason to email a
 * sponsor at all.
 */
export default async function MessageSponsorsPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string }>;
}) {
  return <MessageScreen audienceId="sponsors" searchParams={searchParams} />;
}
