/**
 * Every block kind and every option of the KGC | Learn page contract on one
 * page, for building and checking the editor and the renderer (T311). Not
 * shown to visitors: it is test data, and the screenshots of it are in
 * `orchestrator/reports/T311-shots/`.
 */

import type { LearnPageContent, PageImage } from "./learn-page.js";

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
