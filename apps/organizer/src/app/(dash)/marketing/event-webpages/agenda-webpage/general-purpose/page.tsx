import { ROUTES } from '@/lib/nav';
import { WebpageScreen } from '../../../webpage-screen';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Event Webpages › Agenda Webpage › General-Purpose.
 *
 * Whova's "general purpose" agenda page is the whole programme; the
 * "special purpose" one is a filtered slice for a partner to embed. We render
 * the whole thing at /agenda and a slice would be a query parameter, not a
 * second page — which is why only this one is built.
 */
export default async function AgendaWebpagePage() {
  return (
    <WebpageScreen
      which="agenda"
      title="Agenda Webpage"
      editorHref={ROUTES.sessionManager}
      editorLabel="Session Manager"
      notBuilt={[
        'A filtered "special purpose" variant for one track or day. On our site that is a query parameter on /agenda rather than a separate page, and nothing yet reads one.',
        'Page traffic analytics. Nothing measures visits to the public site — adding a tracker is a privacy decision nobody has taken, not an oversight.',
        'Per-session registration caps shown publicly. Session Cap is its own unbuilt screen under Attendees.',
      ]}
    />
  );
}
