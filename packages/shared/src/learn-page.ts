/**
 * The KGC | Learn page as data, so the person who runs the course can edit it
 * from the dashboard (owner, 2026-10-21).
 *
 * One document, `pageLayouts/learn` (not `pages`, which holds the organizer's custom /{slug} pages), holds a `draft` and a `published` copy of the
 * same shape. The website renders `published`; the editor writes `draft`; a
 * Publish button copies one over the other and keeps the old one in
 * `pageLayouts/learn/versions/{id}`. With no document at all, the website renders
 * `LEARN_PAGE_DEFAULT`, which is today's hard-coded page, so nothing changes
 * until someone publishes.
 *
 * This file is the contract between three builders working at once: the
 * backend (store, actions, uploads, access), the editor UI and the website
 * renderer. Change it only by agreement; add new block kinds at the end.
 */

/** Text with light formatting, stored as the same small Markdown subset as `rich-text-core` (bold, italic, links, line breaks). */
export type RichText = string;

/** Fixed choices, not free CSS, so an edit can never break the page or the brand. */
export type BandBackground = "plain" | "white-wave" | "light-blue-wave" | "blue" | "grey-wave";
export type Align = "left" | "center" | "right";
export type Spacing = "none" | "small" | "medium" | "large";
export type TextSize = "small" | "normal" | "large" | "x-large";
export type ImageWidth = "small" | "medium" | "large" | "full";
export type ImageShape = "square" | "rounded" | "circle" | "original";
export type Columns = 1 | 2 | 3 | 4;

/** An image in Firebase Storage under `pageLayouts/learn/`, or a site asset path such as `/kgc/learn-wordmark.png`. */
export interface PageImage {
  src: string;
  alt: string;
  /** Pixel size of the stored file, for layout without shift. */
  width: number;
  height: number;
  /** Focal point for cropping, 0 to 1 from the top left. */
  focusX?: number;
  focusY?: number;
}

export interface LinkButton {
  label: string;
  href: string;
  style: "primary" | "secondary" | "text";
}

export interface Person {
  id: string;
  name: string;
  role: string;
  photo?: PageImage;
  linkedin?: string;
  bio?: RichText;
}

interface BlockBase {
  /** Stable id, so reorder and undo keep identity. */
  id: string;
  /** Hidden blocks stay in the draft but are not rendered. */
  hidden?: boolean;
  align?: Align;
  spaceAbove?: Spacing;
  spaceBelow?: Spacing;
}

export type LearnBlock =
  | (BlockBase & { kind: "heading"; text: RichText; level: 1 | 2 | 3; size?: TextSize })
  | (BlockBase & { kind: "text"; text: RichText; size?: TextSize })
  | (BlockBase & { kind: "image"; image: PageImage; width: ImageWidth; shape: ImageShape; caption?: string; href?: string })
  | (BlockBase & { kind: "buttons"; buttons: LinkButton[] })
  | (BlockBase & { kind: "people"; style: "cards" | "list"; columns: Columns; people: Person[] })
  | (BlockBase & { kind: "list"; ordered: boolean; items: { id: string; title?: string; text: RichText; children?: string[]; link?: LinkButton }[] })
  | (BlockBase & { kind: "columns"; columns: Columns; items: { id: string; image?: PageImage; title?: string; text: RichText; link?: LinkButton }[] })
  | (BlockBase & { kind: "video"; url: string; caption?: string })
  | (BlockBase & { kind: "divider" })
  | (BlockBase & { kind: "spacer"; size: Spacing });

/** A full-width band of the page, holding blocks. Today's page has four. */
export interface LearnSection {
  id: string;
  /** Shown only in the editor, to name the band ("Hero", "Team"). */
  label: string;
  background: BandBackground;
  /** Wave image behind the first image block only (today's hero). */
  waveBehindFirstImage?: boolean;
  width: "narrow" | "normal" | "wide";
  paddingTop: Spacing;
  paddingBottom: Spacing;
  hidden?: boolean;
  blocks: LearnBlock[];
}

export interface LearnPageContent {
  /** Browser tab title and search description. */
  seoTitle: string;
  seoDescription: string;
  sections: LearnSection[];
}

export interface LearnPageDoc {
  draft: LearnPageContent;
  published: LearnPageContent | null;
  draftUpdatedAt: number;
  draftUpdatedBy: string;
  publishedAt?: number;
  publishedBy?: string;
  /** Bumped on every draft save; a save carrying an older value is refused (two people editing). */
  revision: number;
}

export interface LearnPageVersion {
  content: LearnPageContent;
  publishedAt: number;
  publishedBy: string;
  note?: string;
}

export const LEARN_PAGE_DOC = "pageLayouts/learn";
export const LEARN_PAGE_VERSIONS = "pageLayouts/learn/versions";
export const LEARN_IMAGE_PREFIX = "pageLayouts/learn/";

/**
 * Filled by the website-renderer builder: today's /learn page expressed as
 * blocks, so rendering it gives the same page as the hard-coded version.
 */
export declare const LEARN_PAGE_DEFAULT: LearnPageContent;
