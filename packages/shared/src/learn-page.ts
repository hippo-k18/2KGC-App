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

/* ── v2 (T315): a real rich text document ─────────────────────────────────
 * Every place that held `RichText` now holds `RichContent`: either the old
 * Markdown string (still valid, so v1 drafts and LEARN_PAGE_DEFAULT keep
 * working) or a `RichDoc`, a whitelisted node tree the editor produces.
 * Never HTML: renderers map each node to a component, and the server rejects
 * any node, mark or attribute not listed here.
 */
export type RichContent = RichText | RichDoc;

/** A brand colour by name, or a custom `#rrggbb` (the editor warns on low contrast). */
export type ColorValue = "navy" | "blue" | "light-blue" | "teal" | "orange" | "grey" | "dark" | "white" | `#${string}`;

export type RichMark =
  | { type: "bold" } | { type: "italic" } | { type: "underline" } | { type: "strike" }
  | { type: "code" } | { type: "superscript" } | { type: "subscript" }
  | { type: "link"; href: string; newTab?: boolean }
  | { type: "color"; color: ColorValue }
  | { type: "highlight"; color: ColorValue }
  | { type: "fontSize"; size: TextSize };

export type TextAlign = Align | "justify";

export type RichNode =
  | { type: "text"; text: string; marks?: RichMark[] }
  | { type: "hardBreak" }
  | { type: "paragraph"; align?: TextAlign; content?: RichNode[] }
  | { type: "heading"; level: 1 | 2 | 3 | 4; align?: TextAlign; content?: RichNode[] }
  | { type: "bulletList"; content: RichNode[] }
  | { type: "orderedList"; start?: number; content: RichNode[] }
  | { type: "listItem"; content: RichNode[] }
  | { type: "blockquote"; content: RichNode[] }
  | { type: "codeBlock"; content?: RichNode[] }
  | { type: "horizontalRule" }
  | { type: "table"; content: RichNode[] }
  | { type: "tableRow"; content: RichNode[] }
  | { type: "tableHeader"; colspan?: number; rowspan?: number; content: RichNode[] }
  | { type: "tableCell"; colspan?: number; rowspan?: number; content: RichNode[] };

export interface RichDoc {
  type: "doc";
  content: RichNode[];
}

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
  bio?: RichContent;
}

interface BlockBase {
  /** Stable id, so reorder and undo keep identity. */
  id: string;
  /** Hidden blocks stay in the draft but are not rendered. */
  hidden?: boolean;
  align?: Align;
  spaceAbove?: Spacing;
  spaceBelow?: Spacing;
  /* v2 (T315), all optional */
  /** Show on every screen, or only on wide or only on narrow ones. */
  visibleOn?: "all" | "desktop" | "mobile";
  /** In-page link target (`#anchor`), lower-case letters, digits and dashes. */
  anchor?: string;
  /** Narrow a block inside its section. */
  maxWidth?: "small" | "medium" | "large" | "full";
  /** A light card behind the block. */
  boxed?: boolean;
  textColor?: ColorValue;
  /** Editor-only note for colleagues; never rendered on the website. */
  note?: string;
}

export type LearnBlock =
  | (BlockBase & { kind: "heading"; text: RichContent; level: 1 | 2 | 3 | 4; size?: TextSize })
  | (BlockBase & { kind: "text"; text: RichContent; size?: TextSize })
  | (BlockBase & { kind: "image"; image: PageImage; width: ImageWidth; shape: ImageShape; caption?: string; href?: string })
  | (BlockBase & { kind: "buttons"; buttons: LinkButton[] })
  | (BlockBase & { kind: "people"; style: "cards" | "list"; columns: Columns; people: Person[] })
  | (BlockBase & { kind: "list"; ordered: boolean; items: { id: string; title?: string; text: RichContent; children?: string[]; link?: LinkButton }[] })
  | (BlockBase & { kind: "columns"; columns: Columns; items: { id: string; image?: PageImage; title?: string; text: RichContent; link?: LinkButton }[] })
  | (BlockBase & { kind: "video"; url: string; caption?: string })
  | (BlockBase & { kind: "divider" })
  | (BlockBase & { kind: "spacer"; size: Spacing })
  /* v2 (T315) block kinds, added at the end */
  | (BlockBase & { kind: "imageText"; image: PageImage; imageSide: "left" | "right"; imageWidth: "third" | "half"; shape: ImageShape; text: RichContent; buttons?: LinkButton[] })
  | (BlockBase & { kind: "gallery"; layout: "grid" | "carousel" | "masonry"; columns: Columns; images: (PageImage & { id: string; caption?: string })[]; lightbox: boolean })
  | (BlockBase & { kind: "quote"; text: RichContent; name?: string; role?: string; photo?: PageImage; style: "plain" | "large" | "card" })
  | (BlockBase & { kind: "callout"; tone: "info" | "success" | "warning" | "brand"; title?: string; text: RichContent })
  | (BlockBase & { kind: "accordion"; items: { id: string; title: string; text: RichContent; open?: boolean }[]; allowMany: boolean })
  | (BlockBase & { kind: "tabs"; items: { id: string; title: string; text: RichContent }[] })
  | (BlockBase & { kind: "stats"; columns: Columns; items: { id: string; value: string; label: string }[] })
  | (BlockBase & { kind: "cards"; columns: Columns; items: { id: string; image?: PageImage; title: string; text: RichContent; link?: LinkButton; badge?: string }[] })
  | (BlockBase & { kind: "logos"; grayscale: boolean; items: (PageImage & { id: string; href?: string })[] })
  | (BlockBase & { kind: "embed"; provider: "youtube" | "vimeo" | "google-maps" | "google-forms" | "google-docs" | "google-slides" | "calendly" | "typeform" | "loom" | "spotify"; url: string; aspect: "16:9" | "4:3" | "1:1" | "auto"; height?: number; title: string })
  | (BlockBase & { kind: "countdown"; until: number; label?: string; doneText?: string })
  | (BlockBase & { kind: "table"; doc: RichDoc; striped: boolean; caption?: string })
  | (BlockBase & { kind: "toc"; title?: string })
  | (BlockBase & { kind: "reusable"; libraryId: string });

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
  /* v2 (T315), all optional */
  /** Overrides `background` when set. */
  backgroundColor?: ColorValue;
  backgroundImage?: PageImage;
  /** Dark overlay over a background image, 0 to 0.8, so text stays readable. */
  overlay?: number;
  anchor?: string;
  visibleOn?: "all" | "desktop" | "mobile";
  /** Split the section into side-by-side columns; each block says which column. */
  layout?: "single" | "two-equal" | "two-wide-left" | "two-wide-right" | "three";
  /** Per block id, which column (0-based) in a multi-column layout. */
  blockColumn?: Record<string, number>;
  note?: string;
}

export interface LearnPageContent {
  /** Browser tab title and search description. */
  seoTitle: string;
  seoDescription: string;
  sections: LearnSection[];
  /* v2 (T315), all optional */
  /** Image shown when the page is shared on LinkedIn, Slack and so on. */
  ogImage?: PageImage;
  /** Hide from search engines (noindex). */
  noindex?: boolean;
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
  /* v2 (T315), all optional */
  /** Publish the draft automatically at this time (ms). Cleared on publish or cancel. */
  scheduledPublishAt?: number;
  scheduledBy?: string;
  /** Unguessable token for a read-only draft preview link; rotate to revoke. */
  previewToken?: string;
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
/** v2 (T315): saved sections anyone can drop into the page (`reusable` blocks point here). */
export const LEARN_PAGE_LIBRARY = "pageLayouts/learn/library";
export interface LearnLibraryItem {
  name: string;
  section: LearnSection;
  createdAt: number;
  createdBy: string;
}
/** v2 (T315): one row per uploaded image, so the media library can list, rename, search and see where each is used. */
export const LEARN_PAGE_MEDIA = "pageLayouts/learn/media";
export interface LearnMediaItem {
  image: PageImage;
  fileName: string;
  bytes: number;
  uploadedAt: number;
  uploadedBy: string;
  tags?: string[];
}

const LEARN_BROCHURE = "mailto:contact@knowledgegraph.tech?subject=KGC%20Learn%20brochure";

const brochure = (): LinkButton => ({
  label: "Learn more and download the brochure.",
  href: LEARN_BROCHURE,
  style: "text",
});

const founder = (id: string, name: string, role: string, src: string, linkedin: string): Person => ({
  id,
  name,
  role,
  photo: { src, alt: name, width: 200, height: 200 },
  linkedin,
});

const rosterMember = (id: string, name: string, role: string): Person => ({ id, name, role });

/**
 * Today's /learn page expressed as blocks, so rendering it gives the same page
 * as the hard-coded version did (pixel-diffed in T311).
 *
 * The three founders are a copy of `LEARN_FOUNDERS` in `apps/web/src/lib/people.ts`,
 * because this package cannot import the website. A website test fails if the
 * two drift apart. Once someone publishes, the stored copy is what shows.
 */
export const LEARN_PAGE_DEFAULT: LearnPageContent = {
  seoTitle: "The Knowledge Graph Learning Program",
  seoDescription:
    "KGC | Learn: the team, the continuing education roster, and the four certificate programmes.",
  sections: [
    {
      id: "hero",
      label: "Hero",
      background: "grey-wave",
      waveBehindFirstImage: true,
      width: "normal",
      paddingTop: "none",
      paddingBottom: "large",
      blocks: [
        {
          id: "hero-wordmark",
          kind: "image",
          image: { src: "/kgc/learn-wordmark.png", alt: "KGC | Learn", width: 1000, height: 275 },
          width: "large",
          shape: "original",
          align: "center",
        },
        {
          id: "hero-tagline",
          kind: "text",
          text: "Learn how knowledge graphs can shape the future of your business and career.",
          align: "center",
          spaceAbove: "medium",
          spaceBelow: "small",
        },
        {
          id: "hero-strap",
          kind: "text",
          text: "*Where peer-learning drives practice.*",
          align: "center",
          spaceBelow: "none",
        },
      ],
    },
    {
      id: "team",
      label: "Team",
      background: "white-wave",
      width: "normal",
      paddingTop: "large",
      paddingBottom: "large",
      blocks: [
        { id: "team-heading", kind: "heading", level: 2, text: "Meet the **KGC | Learn** Team", align: "center" },
        {
          id: "team-intro",
          kind: "text",
          text: "KGC|Learn was established by KGC with a 2023 grant from the National Science Foundation to attract the best of the KGC Community and Conferences.",
          align: "center",
          spaceBelow: "large",
        },
        {
          id: "team-founders",
          kind: "people",
          style: "cards",
          columns: 3,
          spaceBelow: "none",
          people: [
            founder("francois-scharffe", "François Scharffe", "Co-Founder", "/kgc/team/francois-scharffe.jpeg", "https://www.linkedin.com/in/francoischarffe/"),
            founder("thomas-deely", "Thomas Deely", "Co-Founder", "/kgc/team/thomas-deely.jpg", "https://www.linkedin.com/in/thomasdeely/"),
            founder("maru-willson", "Maru Willson", "Chief Learning Officer", "/kgc/team/maru-willson.jpeg", "https://www.linkedin.com/in/maruwillson/"),
          ],
        },
      ],
    },
    {
      id: "continuing-education",
      label: "Continuing education",
      background: "light-blue-wave",
      width: "normal",
      paddingTop: "large",
      paddingBottom: "large",
      blocks: [
        {
          id: "ce-heading",
          kind: "heading",
          level: 2,
          text: "Meet the **KGC|Learn**\nContinuing Education Team",
          align: "center",
        },
        {
          id: "ce-roster",
          kind: "people",
          style: "list",
          columns: 4,
          align: "center",
          spaceBelow: "none",
          people: [
            rosterMember("alex-shifrin", "Alex Shifrin", "Subject Matter Lead"),
            rosterMember("casey-hart", "Casey Hart", "Guest Instructor"),
            rosterMember("keith-corbett", "Keith Corbett", "Teaching Assistant"),
            rosterMember("anatoly-scherbakov", "Anatoly Scherbakov", "Teaching Assistant"),
            rosterMember("adam-shepherd", "Adam Shepherd", "Teaching Assistant"),
            rosterMember("vinay-chaudhri", "Vinay Chaudhri", "Guest Instructor"),
          ],
        },
      ],
    },
    {
      id: "programmes",
      label: "Programmes",
      background: "blue",
      width: "normal",
      paddingTop: "medium",
      paddingBottom: "medium",
      blocks: [
        {
          id: "programmes-heading",
          kind: "heading",
          level: 2,
          text: "Find the program\nthat is right for you",
          align: "center",
        },
        {
          id: "programmes-intro-1",
          kind: "text",
          text: "Our program brings together open content from leading knowledge graph practitioners in a structured and guided environment for learners.",
          align: "left",
        },
        {
          id: "programmes-intro-2",
          kind: "text",
          text: "We use evidence-based adult learning approaches to meet participants where they are in their knowledge graph learning journey.",
          align: "left",
        },
        {
          id: "programmes-list",
          kind: "list",
          ordered: false,
          align: "left",
          spaceBelow: "none",
          items: [
            {
              id: "explorer",
              title: "Explorer Certificate",
              text: "fully online for individuals without prior experience who learn at their own pace.",
              link: brochure(),
            },
            {
              id: "builder",
              title: "Builder Micro-Certificates",
              text: "part-virtual and part-online for individuals with experience in data science and adjacent fields who benefit from a cohort structure.",
              link: brochure(),
              children: [
                "Builder MC-1 Bricks to Building KGs",
                "Builder MC-2 Build with Confidence",
                "Builder MC-3 Build with Nuance",
                "Builder MC-4 Build Something Real",
              ],
            },
            {
              id: "team-upskilling",
              title: "Team Upskilling",
              text: "for organizations introducing knowledge graphs and AI-readiness to teams of 5 or more.",
              link: brochure(),
            },
            {
              id: "open-classroom",
              title: "Open Classroom",
              text: "free access to our curated content without the structure and rigor of a certificate.",
              link: brochure(),
            },
          ],
        },
      ],
    },
  ],
};
