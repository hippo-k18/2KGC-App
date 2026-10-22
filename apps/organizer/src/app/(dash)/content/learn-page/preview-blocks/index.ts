/**
 * Dashboard twins of the Learn page's v2 blocks and rich text (T319), for the
 * editor's preview frame (T318 wires them in).
 *
 * Everything except this file, `preview-font.ts` and `site-base.css` is a
 * byte-for-byte copy of `apps/web/src/components/learn-blocks/`, which the
 * website's `/learn` renders with. `tests/parity/learn-blocks-twins.test.ts`
 * fails when the two drift: edit the website copy, then copy it here.
 *
 * How to use them in the preview frame:
 *
 * - Put `lp-page` on the frame's page element. It is the size container the
 *   phone rules measure, so a 390px frame gets the phone layout. Put
 *   `lp-site-base` and `previewFontClass` on it too, for the website's type,
 *   colours and buttons.
 * - Build one `BlockCtx` per render with `makeBlockCtx(content, siteOrigin)`.
 * - A v2 block: `isV2Block(block) && <LearnV2Block block={block} ctx={ctx} content={content} />`.
 *   Its outer element carries `data-block-id={block.id}` for selection.
 * - Any block's v2 options (visibility, max width, boxed, text colour):
 *   `blockShell(block, ...extraClasses)` gives the class string and style.
 * - Rich text: `<RichBlocks value={text} />` in a body, `<RichInline value={text} />`
 *   inside a heading or list item. Both take a v1 Markdown string or a RichDoc.
 * - A section: `sectionShell(section)` for its classes and `--lp-band`,
 *   `<SectionBackground>` for the photo and overlay, `<SectionLayout>` for
 *   multi-column layouts (pass your own block renderer).
 * - `reusable` blocks are not drawn here: expand them first with
 *   `expandReusableBlocks` from `@kgc/shared`, as the website does.
 */

import { headingIds, type LearnPageContent } from '@kgc/shared';
import type { BlockCtx } from './parts';
import './learn-blocks.css';
import './site-base.css';

export { blockAttrs, blockShell, HeadingText, isV2Block, LearnV2Block, V2_BLOCK_KINDS, type V2Block } from './blocks';
export { LearnCountdown, LearnGallery, LearnTabs, type GalleryImage } from './interactive';
export { Button, ItemLink, Picture, SmartLink, type BlockCtx } from './parts';
export { MarkdownSpans, RichBlocks, RichInline, RichTable, richHasText } from './rich';
export { SectionBackground, SectionLayout, sectionShell } from './section';
export { previewFontClass } from './preview-font';

/**
 * A render context for one preview render. `siteOrigin` prefixes the site's
 * own assets (`/kgc/...`), which the dashboard does not serve.
 */
export function makeBlockCtx(content: LearnPageContent, siteOrigin: string, now = Date.now()): BlockCtx {
  return { assetOrigin: siteOrigin, remoteImages: 'plain', firstImage: { used: false }, headingIds: headingIds(content), now };
}
