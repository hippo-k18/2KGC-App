/**
 * Every block kind and every option of the KGC | Learn page contract on one
 * page, for building and checking the editor and the renderer (T311). Not
 * shown to visitors: it is test data, and the screenshots of it are in
 * `orchestrator/reports/T311-shots/`.
 */

import type { LearnPageContent, LearnSection, PageImage, RichDoc, RichNode } from "./learn-page.js";

const park: PageImage = {
  src: "/kgc/bryant-park/from-empire-state-building.jpg",
  alt: "Bryant Park from the Empire State Building",
  width: 2400,
  height: 1800,
};
const room = (n: string, alt: string): PageImage => ({ src: `/kgc/photos/${n}.jpeg`, alt, width: 2048, height: 1365 });
const portrait = (file: string, alt: string): PageImage => ({ src: `/kgc/team/${file}`, alt, width: 200, height: 200 });

export const LEARN_PAGE_KITCHEN_SINK: LearnPageContent = {
  seoTitle: "Learn page sample",
  seoDescription: "Every block and option of the KGC | Learn page editor.",
  sections: [
    {
      id: "s-hero",
      label: "Hero (grey wave behind the first image)",
      background: "grey-wave",
      waveBehindFirstImage: true,
      width: "normal",
      paddingTop: "none",
      paddingBottom: "large",
      blocks: [
        {
          id: "b-wordmark",
          kind: "image",
          image: { src: "/kgc/learn-wordmark.png", alt: "KGC | Learn", width: 1000, height: 275 },
          width: "medium",
          shape: "original",
        },
        { id: "b-h1", kind: "heading", level: 1, text: "Heading level 1, extra large", spaceAbove: "medium" },
        {
          id: "b-lead",
          kind: "text",
          size: "large",
          align: "center",
          text: "Large text with **bold**, *italic*, `code` and [a link](/tickets).\nA single line break stays a line break.",
        },
        {
          id: "b-buttons",
          kind: "buttons",
          align: "center",
          spaceAbove: "medium",
          buttons: [
            { label: "Primary button", href: "/tickets", style: "primary" },
            { label: "Secondary button", href: "/agenda", style: "secondary" },
            { label: "Text link", href: "https://example.com", style: "text" },
          ],
        },
      ],
    },
    {
      id: "s-text",
      label: "Text sizes and alignment (plain, narrow)",
      background: "plain",
      width: "narrow",
      paddingTop: "medium",
      paddingBottom: "medium",
      blocks: [
        { id: "b-h2", kind: "heading", level: 2, text: "Heading level 2, **large** by default" },
        { id: "b-h3", kind: "heading", level: 3, text: "Heading level 3, normal", align: "left" },
        { id: "b-h3s", kind: "heading", level: 3, size: "small", text: "Heading level 3, small, right", align: "right" },
        { id: "b-small", kind: "text", size: "small", text: "Small text, left aligned. A second sentence to show the line length." },
        { id: "b-normal", kind: "text", text: "Normal text, centred.\n\nA blank line starts a new paragraph.", align: "center" },
        { id: "b-xl", kind: "text", size: "x-large", align: "right", text: "Extra large, right" },
        { id: "b-hidden", kind: "text", hidden: true, text: "HIDDEN BLOCK: this must never appear." },
        { id: "b-divider", kind: "divider", spaceAbove: "large", spaceBelow: "large" },
        {
          id: "b-ol",
          kind: "list",
          ordered: true,
          items: [
            { id: "i1", title: "A titled item", text: "with body text and a button.", link: { label: "Book", href: "/tickets", style: "primary" } },
            { id: "i2", text: "An item with sub-items.", children: ["First sub-item", "Second sub-item with **bold**"] },
            { id: "i3", title: "Text link", text: "after the words.", link: { label: "Read more.", href: "/about", style: "text" } },
          ],
        },
      ],
    },
    {
      id: "s-images",
      label: "Image widths and shapes (white wave)",
      background: "white-wave",
      width: "normal",
      paddingTop: "large",
      paddingBottom: "large",
      blocks: [
        { id: "b-img-h", kind: "heading", level: 2, size: "normal", text: "Images" },
        { id: "b-img-full", kind: "image", image: park, width: "full", shape: "rounded", caption: "Full width, rounded, with a caption." },
        { id: "b-img-large", kind: "image", image: room("1746718623813", "A workshop room"), width: "large", shape: "original", caption: "Large, original shape, links to the agenda.", href: "/agenda" },
        {
          id: "b-img-sq",
          kind: "image",
          image: { ...park, focusX: 0.2, focusY: 0.8 },
          width: "medium",
          shape: "square",
          align: "left",
          caption: "Medium, square, left, focal point bottom left.",
        },
        { id: "b-img-circle", kind: "image", image: { ...park, focusX: 0.5, focusY: 0.3 }, width: "small", shape: "circle", align: "right", caption: "Small circle, right." },
      ],
    },
    {
      id: "s-people",
      label: "People (light blue wave)",
      background: "light-blue-wave",
      width: "wide",
      paddingTop: "large",
      paddingBottom: "large",
      blocks: [
        { id: "b-ppl-h", kind: "heading", level: 2, size: "normal", text: "People as cards, four across" },
        {
          id: "b-cards4",
          kind: "people",
          style: "cards",
          columns: 4,
          people: [
            { id: "p1", name: "François Scharffe", role: "Co-Founder", photo: portrait("francois-scharffe.jpeg", "François Scharffe"), linkedin: "https://www.linkedin.com/in/francoischarffe/", bio: "A short bio with **bold** and a [link](/team)." },
            { id: "p2", name: "Thomas Deely", role: "Co-Founder", photo: portrait("thomas-deely.jpg", "Thomas Deely"), linkedin: "https://www.linkedin.com/in/thomasdeely/" },
            { id: "p3", name: "Maru Willson", role: "Chief Learning Officer", photo: portrait("maru-willson.jpeg", "Maru Willson") },
            { id: "p4", name: "No Photo", role: "Guest Instructor" },
          ],
        },
        { id: "b-list-h", kind: "heading", level: 2, size: "normal", text: "People as a list, three across, left", spaceAbove: "large" },
        {
          id: "b-list3",
          kind: "people",
          style: "list",
          columns: 3,
          align: "left",
          people: [
            { id: "l1", name: "Alex Shifrin", role: "Subject Matter Lead", linkedin: "https://www.linkedin.com/" },
            { id: "l2", name: "Casey Hart", role: "Guest Instructor", bio: "Bio under a list entry." },
            { id: "l3", name: "Keith Corbett", role: "Teaching Assistant" },
            { id: "l4", name: "Vinay Chaudhri", role: "Guest Instructor" },
          ],
        },
        { id: "b-cards2-h", kind: "heading", level: 3, text: "Two across, centred", spaceAbove: "large" },
        {
          id: "b-cards2",
          kind: "people",
          style: "cards",
          columns: 2,
          align: "center",
          people: [
            { id: "c1", name: "Thomas Deely", role: "Co-Founder", photo: portrait("thomas-deely.jpg", "Thomas Deely"), linkedin: "https://www.linkedin.com/in/thomasdeely/" },
            { id: "c2", name: "Maru Willson", role: "Chief Learning Officer", photo: portrait("maru-willson.jpeg", "Maru Willson"), linkedin: "https://www.linkedin.com/in/maruwillson/" },
          ],
        },
      ],
    },
    {
      id: "s-columns",
      label: "Columns (blue)",
      background: "blue",
      width: "normal",
      paddingTop: "medium",
      paddingBottom: "medium",
      blocks: [
        { id: "b-col-h", kind: "heading", level: 2, size: "normal", text: "Columns" },
        {
          id: "b-col3",
          kind: "columns",
          columns: 3,
          items: [
            { id: "k1", image: room("1746718623813", "Workshop"), title: "With an image", text: "Text under the title.", link: { label: "Text link", href: "/agenda", style: "text" } },
            { id: "k2", image: room("1746544706151", "Audience"), title: "And a button", text: "Two paragraphs.\n\nThe second one.", link: { label: "Primary", href: "/tickets", style: "primary" } },
            { id: "k3", title: "No image", text: "Just a title and text, and a *secondary* button.", link: { label: "Secondary", href: "/about", style: "secondary" } },
          ],
        },
        { id: "b-spacer", kind: "spacer", size: "large" },
        {
          id: "b-col4",
          kind: "columns",
          columns: 4,
          items: [
            { id: "q1", title: "One", text: "Four columns." },
            { id: "q2", title: "Two", text: "Two on a tablet." },
            { id: "q3", title: "Three", text: "One on a phone." },
            { id: "q4", title: "Four", text: "Text only." },
          ],
        },
      ],
    },
    {
      id: "s-video",
      label: "Video (plain)",
      background: "plain",
      width: "normal",
      paddingTop: "small",
      paddingBottom: "small",
      blocks: [
        { id: "b-vid-h", kind: "heading", level: 2, size: "small", text: "Video, YouTube and Vimeo only" },
        { id: "b-yt", kind: "video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", caption: "A YouTube link." },
        { id: "b-vimeo", kind: "video", url: "https://vimeo.com/76979871", caption: "A Vimeo link.", spaceAbove: "medium" },
        { id: "b-bad", kind: "video", url: "https://example.com/video.mp4", caption: "NOT ALLOWED: this must never appear." },
      ],
    },
    {
      id: "s-hidden",
      label: "Hidden section",
      background: "blue",
      width: "normal",
      paddingTop: "large",
      paddingBottom: "large",
      hidden: true,
      blocks: [{ id: "b-hs", kind: "text", text: "HIDDEN SECTION: this must never appear." }],
    },
  ],
};

/* ── v2 (T319) ─────────────────────────────────────────────────────────── */

const t = (text: string, ...marks: Extract<RichNode, { type: "text" }>["marks"] & {}): RichNode =>
  marks.length ? { type: "text", text, marks } : { type: "text", text };
const para = (...content: RichNode[]): RichNode => ({ type: "paragraph", content });
const doc = (...content: RichNode[]): RichDoc => ({ type: "doc", content });
const cell = (text: string, header = false): RichNode => ({ type: header ? "tableHeader" : "tableCell", content: [para(t(text))] });
const row = (...cells: RichNode[]): RichNode => ({ type: "tableRow", content: cells });
const logo = (id: string, file: string, alt: string, width: number, height: number, href?: string) => ({
  id,
  src: `/kgc/sponsors/${file}`,
  alt,
  width,
  height,
  ...(href ? { href } : {}),
});
const photo = (id: string, n: string, alt: string, width: number, height: number, caption?: string) => ({
  id,
  src: `/kgc/photos/${n}.jpeg`,
  alt,
  width,
  height,
  ...(caption ? { caption } : {}),
});

/** A rich document with every node and mark in the contract. */
export const LEARN_RICH_DOC_SAMPLE: RichDoc = doc(
  { type: "heading", level: 2, content: [t("A rich heading, level 2")] },
  para(
    t("Plain, "),
    t("bold", { type: "bold" }),
    t(", "),
    t("italic", { type: "italic" }),
    t(", "),
    t("underline", { type: "underline" }),
    t(", "),
    t("strike", { type: "strike" }),
    t(", "),
    t("code", { type: "code" }),
    t(", x"),
    t("2", { type: "superscript" }),
    t(", H"),
    t("2", { type: "subscript" }),
    t("O, "),
    t("a link", { type: "link", href: "/tickets" }),
    t(", "),
    t("a new tab link", { type: "link", href: "https://www.knowledgegraph.tech", newTab: true }),
    t(", "),
    t("navy", { type: "color", color: "navy" }),
    t(", "),
    t("custom colour", { type: "color", color: "#b82105" }),
    t(", "),
    t("highlight", { type: "highlight", color: "light-blue" }),
    t(", "),
    t("large", { type: "fontSize", size: "large" }),
    t(" and "),
    t("all at once", { type: "bold" }, { type: "italic" }, { type: "underline" }, { type: "color", color: "teal" }),
    t("."),
    { type: "hardBreak" },
    t("A hard break starts this line."),
  ),
  { type: "paragraph", align: "center", content: [t("A centred paragraph.")] },
  { type: "paragraph", align: "right", content: [t("A right aligned paragraph.")] },
  {
    type: "paragraph",
    align: "justify",
    content: [
      t(
        "A justified paragraph runs long enough to wrap onto a second line, so the spacing between words stretches to meet both edges of the column.",
      ),
    ],
  },
  { type: "heading", level: 3, content: [t("Lists, level 3")] },
  {
    type: "bulletList",
    content: [
      { type: "listItem", content: [para(t("A bullet"))] },
      {
        type: "listItem",
        content: [para(t("A bullet with a nested list")), { type: "bulletList", content: [{ type: "listItem", content: [para(t("Nested"))] }] }],
      },
    ],
  },
  {
    type: "orderedList",
    start: 3,
    content: [
      { type: "listItem", content: [para(t("Numbered from three"))] },
      { type: "listItem", content: [para(t("Four"))] },
    ],
  },
  { type: "heading", level: 4, content: [t("Quote and code, level 4")] },
  { type: "blockquote", content: [para(t("A blockquote inside running text."))] },
  { type: "codeBlock", content: [t("MATCH (p:Person)-[:KNOWS]->(q)\nRETURN p, q")] },
  { type: "horizontalRule" },
  {
    type: "table",
    content: [
      row(cell("Programme", true), cell("Format", true), cell("Length", true)),
      row(cell("Explorer"), cell("Online, own pace"), cell("6 weeks")),
      row({ type: "tableCell", colspan: 2, content: [para(t("Builder spans two cells"))] }, cell("12 weeks")),
    ],
  },
);

const scheduleTable: RichDoc = doc({
  type: "table",
  content: [
    row(cell("Week", true), cell("Topic", true), cell("Format", true), cell("Instructor", true), cell("Hours", true)),
    row(cell("1"), cell("What a knowledge graph is, and is not"), cell("Live online"), cell("Alex Shifrin"), cell("3")),
    row(cell("2"), cell("Modelling: classes, properties and identity"), cell("Live online"), cell("Casey Hart"), cell("3")),
    row(cell("3"), cell("Querying with SPARQL and Cypher"), cell("Self-paced"), cell("Keith Corbett"), cell("4")),
    row(cell("4"), cell("Graphs and language models together"), cell("In person, New York"), cell("Vinay Chaudhri"), cell("6")),
  ],
});

/** A saved library section, for the `reusable` block in the v2 sample. */
export const LEARN_LIBRARY_SAMPLE: Record<string, LearnSection> = {
  "lib-cta": {
    id: "lib-cta",
    label: "Call to action (library)",
    background: "plain",
    width: "normal",
    paddingTop: "medium",
    paddingBottom: "medium",
    blocks: [
      { id: "cta-h", kind: "heading", level: 3, text: "From the library: ready to start?", align: "center" },
      {
        id: "cta-b",
        kind: "buttons",
        align: "center",
        buttons: [{ label: "Ask about the next cohort", href: "mailto:contact@knowledgegraph.tech", style: "primary" }],
      },
    ],
  },
};

/**
 * Every v2 block kind, rich node, mark and block, section and page option,
 * for building and pixel-checking the website renderer against the
 * dashboard preview twins (T319). Test data, never shown to visitors.
 * `until` is fixed so screenshots can freeze the clock.
 */
export const LEARN_PAGE_KITCHEN_SINK_V2: LearnPageContent = {
  seoTitle: "Learn page sample, v2",
  seoDescription: "Every v2 block and option of the KGC | Learn page editor.",
  ogImage: park,
  sections: [
    {
      id: "v2-intro",
      label: "Rich text and table of contents",
      background: "plain",
      width: "normal",
      paddingTop: "medium",
      paddingBottom: "medium",
      anchor: "start",
      blocks: [
        { id: "v2-h1", kind: "heading", level: 1, text: doc(para(t("Learn page "), t("v2", { type: "color", color: "orange" }), t(" sample"))), align: "center" },
        { id: "v2-toc", kind: "toc", title: "On this page", maxWidth: "medium" },
        { id: "v2-rich-h", kind: "heading", level: 2, text: "Rich text", anchor: "rich-text", size: "normal" },
        { id: "v2-rich", kind: "text", text: LEARN_RICH_DOC_SAMPLE, textColor: "dark", note: "Never rendered." },
      ],
    },
    {
      id: "v2-media",
      label: "Image and text, gallery, logos",
      background: "white-wave",
      width: "normal",
      paddingTop: "medium",
      paddingBottom: "medium",
      blocks: [
        { id: "v2-media-h", kind: "heading", level: 2, text: "Image and text", size: "normal" },
        {
          id: "v2-it-left",
          kind: "imageText",
          image: room("1746718623813", "A workshop room"),
          imageSide: "left",
          imageWidth: "half",
          shape: "rounded",
          text: doc({ type: "heading", level: 3, content: [t("Learn with peers")] }, para(t("Half and half, image on the left, with two buttons."))),
          buttons: [
            { label: "Book", href: "/tickets", style: "primary" },
            { label: "Agenda", href: "/agenda", style: "secondary" },
          ],
        },
        {
          id: "v2-it-right",
          kind: "imageText",
          image: room("1746544706151", "An audience"),
          imageSide: "right",
          imageWidth: "third",
          shape: "square",
          text: "A third on the **right**, square, with Markdown text from v1.",
          spaceAbove: "large",
        },
        { id: "v2-gal-h", kind: "heading", level: 2, text: "Gallery", size: "normal", spaceAbove: "large" },
        {
          id: "v2-gal-grid",
          kind: "gallery",
          layout: "grid",
          columns: 3,
          lightbox: true,
          images: [
            photo("g1", "1746718623163", "Talk in the main hall", 2048, 1365, "Grid, with a lightbox"),
            photo("g2", "1746718624050", "Hallway conversation", 1919, 1536),
            photo("g3", "1747294709286", "Workshop tables", 1600, 1200),
          ],
        },
        {
          id: "v2-gal-masonry",
          kind: "gallery",
          layout: "masonry",
          columns: 3,
          lightbox: false,
          spaceAbove: "medium",
          images: [
            photo("m1", "1746544706151", "Audience", 2040, 1536, "Masonry keeps each shape"),
            photo("m2", "1758317500848", "Stage", 800, 450),
            photo("m3", "1746718623813", "Workshop", 2048, 1365),
            photo("m4", "1746718624050", "Hallway", 1919, 1536),
          ],
        },
        {
          id: "v2-gal-carousel",
          kind: "gallery",
          layout: "carousel",
          columns: 2,
          lightbox: true,
          spaceAbove: "medium",
          images: [
            photo("c1", "1747294709286", "Workshop tables", 1600, 1200, "Carousel, two at a time"),
            photo("c2", "1746718623163", "Main hall", 2048, 1365),
            photo("c3", "1746544706151", "Audience", 2040, 1536),
          ],
        },
        { id: "v2-logos-h", kind: "heading", level: 3, text: "Logos, greyscale", spaceAbove: "large" },
        {
          id: "v2-logos",
          kind: "logos",
          grayscale: true,
          items: [
            logo("l1", "abbvie.png", "AbbVie", 712, 148, "https://www.abbvie.com"),
            logo("l2", "accenture.png", "Accenture", 683, 198),
            logo("l3", "bloomberg.png", "Bloomberg", 906, 386),
            logo("l4", "datahub.png", "DataHub", 975, 268),
          ],
        },
      ],
    },
    {
      id: "v2-dark",
      label: "Navy band, stats and quote",
      background: "plain",
      backgroundColor: "navy",
      width: "normal",
      paddingTop: "medium",
      paddingBottom: "medium",
      anchor: "numbers",
      blocks: [
        { id: "v2-stats-h", kind: "heading", level: 2, text: "Numbers on a navy band", size: "normal" },
        {
          id: "v2-stats",
          kind: "stats",
          columns: 4,
          items: [
            { id: "s1", value: "1,200+", label: "Learners" },
            { id: "s2", value: "40", label: "Instructors" },
            { id: "s3", value: "4", label: "Programmes" },
            { id: "s4", value: "98%", label: "Would recommend" },
          ],
        },
        {
          id: "v2-quote-large",
          kind: "quote",
          style: "large",
          text: "The cohort made the difference. I learned as much from the people next to me as from the course.",
          name: "Casey Hart",
          role: "Builder MC-2",
          photo: portrait("maru-willson.jpeg", "Casey Hart"),
          spaceAbove: "large",
        },
      ],
    },
    {
      id: "v2-photo",
      label: "Photo band with overlay, two columns",
      background: "plain",
      backgroundImage: park,
      overlay: 0.55,
      width: "normal",
      paddingTop: "large",
      paddingBottom: "large",
      layout: "two-equal",
      blockColumn: { "v2-col-a": 0, "v2-col-b": 1, "v2-col-btn": 1 },
      blocks: [
        { id: "v2-col-a", kind: "text", size: "large", text: doc({ type: "heading", level: 2, content: [t("Two columns over a photo")] }, para(t("Left column, white text on a dark overlay."))) },
        { id: "v2-col-b", kind: "quote", style: "card", text: "A card quote in the right column keeps its own colours.", name: "Maru Willson", role: "Chief Learning Officer" },
        { id: "v2-col-btn", kind: "buttons", align: "left", buttons: [{ label: "Talk to us", href: "mailto:contact@knowledgegraph.tech", style: "primary" }], spaceAbove: "small" },
      ],
    },
    {
      id: "v2-interactive",
      label: "Callouts, accordion, tabs, countdown",
      background: "light-blue-wave",
      width: "normal",
      paddingTop: "medium",
      paddingBottom: "medium",
      blocks: [
        { id: "v2-call-h", kind: "heading", level: 2, text: "Callouts", size: "normal" },
        { id: "v2-call-info", kind: "callout", tone: "info", title: "Info", text: "Applications for the spring cohort open in January." },
        { id: "v2-call-ok", kind: "callout", tone: "success", title: "Success", text: "Your place is held for seven days.", spaceAbove: "small" },
        { id: "v2-call-warn", kind: "callout", tone: "warning", title: "Warning", text: "Seats are limited to 30 per cohort.", spaceAbove: "small" },
        { id: "v2-call-brand", kind: "callout", tone: "brand", text: doc(para(t("A brand callout with "), t("a link", { type: "link", href: "/learn" }), t("."))), spaceAbove: "small" },
        { id: "v2-acc-h", kind: "heading", level: 2, text: "Questions", size: "normal", spaceAbove: "large" },
        {
          id: "v2-acc",
          kind: "accordion",
          allowMany: false,
          items: [
            { id: "a1", title: "Who is the Explorer Certificate for?", text: "Anyone new to knowledge graphs. No coding needed.", open: true },
            { id: "a2", title: "How much time does it take?", text: doc(para(t("About "), t("three hours", { type: "bold" }), t(" a week."))) },
            { id: "a3", title: "Do I get a certificate?", text: "Yes, once you finish the final project." },
          ],
        },
        { id: "v2-tabs-h", kind: "heading", level: 2, text: "Tabs", size: "normal", spaceAbove: "large" },
        {
          id: "v2-tabs",
          kind: "tabs",
          items: [
            { id: "t1", title: "Explorer", text: "Fully online, at your own pace." },
            { id: "t2", title: "Builder", text: doc(para(t("Part virtual, part online, in a cohort.")), { type: "bulletList", content: [{ type: "listItem", content: [para(t("Four micro-certificates"))] }] }) },
            { id: "t3", title: "Team Upskilling", text: "For teams of five or more." },
          ],
        },
        { id: "v2-count", kind: "countdown", until: Date.UTC(2027, 4, 4, 13, 0, 0), label: "The next cohort starts in", doneText: "The cohort has started.", spaceAbove: "large", boxed: true, maxWidth: "medium" },
      ],
    },
    {
      id: "v2-cards",
      label: "Cards, table, embeds, options",
      background: "grey-wave",
      width: "wide",
      paddingTop: "medium",
      paddingBottom: "medium",
      blocks: [
        { id: "v2-cards-h", kind: "heading", level: 2, text: "Cards", size: "normal" },
        {
          id: "v2-cards",
          kind: "cards",
          columns: 3,
          items: [
            { id: "k1", image: room("1746718623813", "Workshop"), title: "Explorer Certificate", text: "Online, at your own pace.", badge: "New", link: { label: "Learn more", href: "/learn#numbers", style: "text" } },
            { id: "k2", image: room("1746544706151", "Audience"), title: "Builder Micro-Certificates", text: doc(para(t("Part virtual, part online."))), link: { label: "Apply", href: "/tickets", style: "primary" } },
            { id: "k3", title: "Open Classroom", text: "Free access to the curated content." },
          ],
        },
        { id: "v2-table-h", kind: "heading", level: 2, text: "Schedule table", size: "normal", spaceAbove: "large" },
        { id: "v2-table", kind: "table", doc: scheduleTable, striped: true, caption: "Builder MC-1, spring cohort" },
        { id: "v2-embed-h", kind: "heading", level: 2, text: "Embeds", size: "normal", spaceAbove: "large" },
        { id: "v2-embed-yt", kind: "embed", provider: "youtube", url: "https://youtu.be/dQw4w9WgXcQ", aspect: "16:9", title: "A YouTube video" },
        {
          id: "v2-embed-map",
          kind: "embed",
          provider: "google-maps",
          url: "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3022.3!2d-73.98!3d40.75!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1",
          aspect: "auto",
          height: 360,
          title: "Map of Bryant Park",
          spaceAbove: "medium",
        },
        { id: "v2-embed-bad", kind: "embed", provider: "youtube", url: "https://evil.example/embed/x", aspect: "16:9", title: "NOT ALLOWED: this must never appear." },
        { id: "v2-desktop", kind: "text", visibleOn: "desktop", text: "Shown on wide screens only.", align: "center", spaceAbove: "large", textColor: "teal" },
        { id: "v2-mobile", kind: "text", visibleOn: "mobile", text: "Shown on phones only.", align: "center", spaceAbove: "large", textColor: "#b82105" },
        { id: "v2-boxed", kind: "text", boxed: true, maxWidth: "small", text: "A boxed block, small width.", align: "center" },
        { id: "v2-reuse", kind: "reusable", libraryId: "lib-cta" },
      ],
    },
    {
      id: "v2-three",
      label: "Three columns on a custom colour",
      background: "plain",
      backgroundColor: "#eef6fc",
      width: "normal",
      paddingTop: "small",
      paddingBottom: "small",
      layout: "three",
      blockColumn: { "v2-c1": 0, "v2-c2": 1, "v2-c3": 2 },
      blocks: [
        { id: "v2-c1", kind: "text", size: "small", text: "First of three columns." },
        { id: "v2-c2", kind: "text", size: "small", text: "Second of three columns." },
        { id: "v2-c3", kind: "text", size: "small", text: "Third, on a custom band colour." },
      ],
    },
  ],
};
