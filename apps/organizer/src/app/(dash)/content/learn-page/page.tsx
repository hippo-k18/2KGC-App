import { publicSiteOrigin } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listLearnVersions, loadLearnEditor } from '@/lib/learn-page';
import { LearnUnreadable } from '@/lib/learn-page-core';
import { UnreadableDraft } from './unreadable-draft';
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
 *
 * A stored draft that does not pass the validator (written by hand, or by an
 * older build) gets a screen that can discard it or restore a version, rather
 * than a 500 that would leave the owner no way back in (T320).
 */
export default async function LearnPageEditorPage() {
  await requireOrganizer();
  let initial;
  try {
    initial = await loadLearnEditor();
  } catch (err) {
    if (!(err instanceof LearnUnreadable)) throw err;
    const versions = await listLearnVersions();
    return <UnreadableDraft problems={err.problems} versions={versions} siteOrigin={publicSiteOrigin()} />;
  }
  return <LearnEditor initial={initial} siteOrigin={publicSiteOrigin()} openedAt={Date.now()} />;
}
