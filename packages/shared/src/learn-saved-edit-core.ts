import type { LearnPageContent, LearnSavedSectionEdit, LearnSection } from "./learn-page.js";

/**
 * A saved section being changed from the Learn editor's page (T328).
 *
 * Edit saved section puts an editable copy of the saved section on the page
 * and marks it (`LearnSection.libraryEdit`), so a reload keeps the edit going.
 * The copy is not the page: Publish, by hand or scheduled, and the draft
 * preview link both show the page as Cancel would leave it (`asPublished`), so
 * neither unsaved text nor a second copy of the section reaches a visitor.
 *
 * Pure, so the dashboard and the website share one answer and both test it.
 */

/** The fields a section keeps from the page, not from its saved section. */
export const LEARN_SECTION_HOST_FIELDS = ["anchor", "visibleOn", "hidden", "note"] as const;

/** The section without its edit marker. */
export function withoutEditMarker(section: LearnSection): LearnSection {
  if (!section.libraryEdit) return section;
  const out = { ...section };
  delete out.libraryEdit;
  return out;
}

/**
 * The saved section being changed on the page, if any. Only a marker whose
 * `sectionId` is its own section's counts, and only the first: a duplicated
 * copy carries the marker under a new id and is an ordinary section.
 */
export function savedSectionEditOf(content: LearnPageContent): LearnSavedSectionEdit | null {
  for (const s of content.sections) if (s.libraryEdit && s.libraryEdit.sectionId === s.id) return s.libraryEdit;
  return null;
}

function freshSectionId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const rand = c?.randomUUID ? c.randomUUID().replace(/-/g, "").slice(0, 12) : Math.random().toString(36).slice(2, 14);
  return `s${rand}`;
}

/** Puts the link back where the editable copy is (after Save to library, or on Cancel). */
export function finishSavedSectionEdit(content: LearnPageContent, edit: LearnSavedSectionEdit): LearnPageContent {
  const at = content.sections.findIndex((s) => s.id === edit.sectionId);
  if (at < 0) return content;
  const cur = content.sections[at];
  const r = edit.restore;
  if (r.kind === "whole") {
    const back: LearnSection = { ...withoutEditMarker(r.host), label: cur.label };
    for (const k of LEARN_SECTION_HOST_FIELDS) {
      if (cur[k] !== undefined) (back as unknown as Record<string, unknown>)[k] = cur[k];
      else delete back[k];
    }
    return { ...content, sections: content.sections.map((s, i) => (i === at ? back : s)) };
  }
  const sections = content.sections.filter((_, i) => i !== at);
  if (r.kind === "none") return { ...content, sections };
  const hi = sections.findIndex((s) => s.id === r.hostSectionId);
  if (hi < 0) {
    // The host section was deleted meanwhile: the link comes back in a section of its own.
    sections.splice(at, 0, {
      id: freshSectionId(),
      label: edit.name,
      background: "plain",
      width: "normal",
      paddingTop: "none",
      paddingBottom: "none",
      blocks: [r.block],
    });
    return { ...content, sections };
  }
  const host = sections[hi];
  const blocks = [...host.blocks];
  blocks.splice(Math.min(r.index, blocks.length), 0, r.block);
  const next: LearnSection = { ...host, blocks };
  if (r.column !== undefined) next.blockColumn = { ...(host.blockColumn ?? {}), [r.block.id]: r.column };
  sections[hi] = next;
  return { ...content, sections };
}

/**
 * The page as Publish puts it live (T326 R1): a saved section being changed
 * goes back to its link, as Cancel would leave it, so neither an unsaved
 * copy nor a second copy of the section reaches the website. Every marker is
 * dropped. The draft itself keeps the copy, so the edit goes on.
 */
export function asPublished(content: LearnPageContent): LearnPageContent {
  const edit = savedSectionEditOf(content);
  const out = edit ? finishSavedSectionEdit(content, edit) : content;
  return out.sections.some((s) => s.libraryEdit) ? { ...out, sections: out.sections.map(withoutEditMarker) } : out;
}

/**
 * `asPublished` for a stored draft read as it is, before any reader checks it
 * (the website's preview link). Anything not shaped like a page, or a marker
 * that cannot be applied, leaves the value as it was; the reader that runs
 * next drops whatever it cannot use.
 */
export function storedDraftAsPublished(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { sections?: unknown }).sections)) return raw;
  const sections = (raw as { sections: unknown[] }).sections;
  if (!sections.some((s) => typeof s === "object" && s !== null && "libraryEdit" in s)) return raw;
  try {
    return asPublished(raw as LearnPageContent);
  } catch {
    return raw;
  }
}
