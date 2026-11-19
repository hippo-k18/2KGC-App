import Image from 'next/image';
import type { ReactNode } from 'react';
import { formatPostDate } from '../posts';
import { PostBodyDoc, PostCover } from './render';
import type { PostFields } from './types';

/**
 * A draft laid out in the published post's card: header, cover, body.
 *
 * Shared by the editor's preview and the review link (`/shared/{token}`), so a
 * reviewer sees exactly what the writer previews. Relative imports only, so it
 * renders under Vitest, where `@/` is the mobile app.
 *
 * The cover follows the rule the published page follows (`isFromEditor`):
 * archive posts never get one at the top, because most of their bodies already
 * open with the WordPress featured image. The caller passes `fromEditor`.
 */
export function DraftArticle({
  fields,
  fromEditor,
  avatar,
  legacyHtml,
  coverSizes,
  banner,
}: {
  fields: PostFields;
  fromEditor: boolean;
  avatar?: string | null;
  /** The archive body, when the draft still is one. */
  legacyHtml: string | null;
  /** The cover's rendered width in this page's layout; see `PostCover`. */
  coverSizes: string;
  banner?: ReactNode;
}) {
  return (
    <div className="post-layout" style={{ gridTemplateColumns: 'minmax(0, 1fr)', maxWidth: 1000, paddingTop: 28 }}>
      <div className="post-main">
        {banner}
        <article className="post-card">
          <header>
            <p className="post-categories">{fields.categories.join(' | ')}</p>
            <h1 className="post-title">{fields.title || 'Untitled post'}</h1>
            <div className="post-meta">
              {avatar && <Image src={avatar} alt="" width={75} height={75} className="post-meta-avatar" />}
              <span>By {fields.authorName}</span>
              <span className="post-meta-divider" aria-hidden="true" />
              <span>{fields.date ? formatPostDate(fields.date) : 'Date set when published'}</span>
            </div>
          </header>
          {fromEditor && fields.cover && <PostCover cover={fields.cover} sizes={coverSizes} />}
          {fields.body.kind === 'doc' ? (
            <div className="post-body">
              <PostBodyDoc doc={fields.body.doc} />
            </div>
          ) : (
            <div className="post-body" dangerouslySetInnerHTML={{ __html: legacyHtml ?? '' }} />
          )}
        </article>
      </div>
    </div>
  );
}

/**
 * One 1000px column, less 24px of `--wrap-padding` each side and the card's
 * 32px padding: 888px at most.
 */
export const DRAFT_COVER_SIZES = '(width >= 1000px) 888px, 100vw';
