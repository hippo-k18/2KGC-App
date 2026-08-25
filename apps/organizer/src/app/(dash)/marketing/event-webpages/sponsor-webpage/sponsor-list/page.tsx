import { ROUTES } from '@/lib/nav';
import { WebpageScreen } from '../../../webpage-screen';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Event Webpages › Sponsor Webpage › Sponsor List.
 *
 * Tier order drives three surfaces at once — this page, the sponsor webpage and
 * the app — which is why Sponsor Manager groups by tier rather than showing a
 * flat sortable table.
 */
export default async function SponsorWebpagePage() {
  return (
    <WebpageScreen
      which="sponsors"
      title="Sponsor Webpage"
      editorHref={ROUTES.sponsorManager}
      editorLabel="Sponsor Manager"
      notBuilt={[
        'Reordering tiers. SponsorTier is a four-value union in models.ts, so adding or reordering one is a code change and a deploy. At one event a year that is the cheaper trade, but it is a trade.',
        'Banner placement. Whova puts sponsor banners on the app home, agenda and profile screens; the app has no rendering slots for them.',
        'A per-sponsor public page with offers and downloads. The data exists on SponsorDoc; nothing renders it publicly.',
      ]}
    />
  );
}
