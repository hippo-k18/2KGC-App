import type { BlogRole, DraftState } from './access';
import type { Doc } from './doc';

/**
 * What is stored in `blogPosts` and `blogMembers`.
 *
 * A post carries two copies of itself: `live`, which readers see, and `draft`,
 * which is being worked on. Publishing copies the draft over the live one. That
 * one shape covers a new post (no `live` yet), an edit waiting for review on a
 * published post (both, differing), and an unpublished post (`live` null again).
 */

export type PostBody =
  | { kind: 'doc'; doc: Doc }
  /** An archive post never re-saved: its body is still the file in `src/content/blog`. */
  | { kind: 'legacy'; slug: string };

export interface Cover {
  src: string;
  width: number;
  height: number;
}

export interface PostFields {
  title: string;
  slug: string;
  /** Empty means "use the opening of the post". */
  excerpt: string;
  /** `YYYY-MM-DD`, the date printed on the post. Set on first publish when empty. */
  date: string;
  /** The byline. The writer's name for a new post; the original author for an archive one. */
  authorName: string;
  categories: string[];
  tags: string[];
  cover: Cover | null;
  body: PostBody;
}

export interface BlogPostDoc {
  /** Who owns it. Lower-case email; null for an archive post. */
  authorEmail: string | null;
  /** Set when this record is an archive post from `posts.ts`, and hides that entry. */
  legacySlug?: string;
  live: PostFields | null;
  draft: PostFields;
  draftState: DraftState;
  everPublished: boolean;
  /** Addresses this post was published under before. They redirect to the current one. */
  previousSlugs?: string[];
  reviewNote?: string;
  reviewNoteBy?: string;
  submittedAt?: Date;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string;
}

export interface BlogMemberDoc {
  email: string;
  name: string;
  role: BlogRole;
  status: 'invited' | 'active' | 'removed';
  bio?: string;
  /** A photo uploaded through the editor, served from `/blog-media`. */
  avatar?: string;
  invitedBy?: string;
  invitedAt?: Date;
  lastSignInAt?: Date;
  /** Changed whenever access changes. A session minted under an older one is refused. */
  sessionEpoch: string;
}

/** A post as a page or a list needs it, with the stored dates turned into numbers. */
export interface StoredPost extends Omit<BlogPostDoc, 'submittedAt' | 'publishedAt' | 'createdAt' | 'updatedAt'> {
  id: string;
  submittedAt?: number;
  publishedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** Slugs the blog's own routes use, so no post can take them. */
export const RESERVED_SLUGS = new Set([
  'write', 'media', 'feed', 'rss', 'rss.xml', 'feed.xml', 'page', 'category', 'tag', 'tags',
  'author', 'authors', 'api', 'search', 'admin', 'login', 'sign-in', 'new', 'drafts',
]);

export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

export const isValidSlug = (slug: string) =>
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 100 && !RESERVED_SLUGS.has(slug);
