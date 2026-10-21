import { publicSiteOrigin } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { loadLearnEditor } from '@/lib/learn-page';
import { LearnEditor } from './learn-editor';

export const dynamic = 'force-dynamic';

/**
 * Content › Learn page: the editor for the website's /learn page (T310).
 *
 * Not a Whova screen. The person who runs KGC | Learn edits the text, images
 * and layout here, sees the page as visitors will at three widths, and
 * publishes when ready. The data is `pageLayouts/learn` (a draft and a
 * published copy); the website renders the published one. The store and its
 * rules are T309's, the website renderer is T311's, and the contract between
 * all three is `packages/shared/src/learn-page.ts`.
 */
export default async function LearnPageEditorPage() {
  await requireOrganizer();
  const initial = await loadLearnEditor();
  return <LearnEditor initial={initial} siteOrigin={publicSiteOrigin()} />;
}
