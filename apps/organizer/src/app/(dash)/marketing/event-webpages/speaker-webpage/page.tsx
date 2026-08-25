import { ROUTES } from '@/lib/nav';
import { WebpageScreen } from '../../webpage-screen';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Event Webpages › Speaker Webpage.
 *
 * Headshots lead the problem list on purpose: a speaker grid with holes in it
 * is the most visible form of "this conference is not ready" a public site has,
 * and it is the one an organizer can fix in an afternoon by sending one email.
 */
export default async function SpeakerWebpagePage() {
  return (
    <WebpageScreen
      which="speakers"
      title="Speaker Webpage"
      editorHref={ROUTES.speakerManager}
      editorLabel="Speaker Manager"
      notBuilt={[
        'Ordering speakers by hand. The public page leads with the five the live site leads with and lists the rest alphabetically; Whova lets you drag them.',
        'A per-speaker public profile page. Ours are cards on one page — a speaker with no bio would otherwise get a page that is mostly empty.',
        'Speaker self-service editing. Chasing a bio is Message Speakers today; a form the speaker fills in themselves needs an auth path they do not have.',
      ]}
    />
  );
}
