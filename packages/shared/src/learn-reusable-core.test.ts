import { describe, expect, it } from "vitest";

import { LEARN_PAGE_DEFAULT, type LearnBlock, type LearnPageContent, type LearnSection } from "./learn-page.js";
import { expandReusableBlocks, expandedBlockId, reusableLibraryIds, reusableUses } from "./learn-reusable-core.js";

const text = (id: string, extra: Partial<LearnBlock> = {}): LearnBlock => ({ id, kind: "text", text: id, ...extra }) as LearnBlock;
const reuse = (id: string, libraryId: string, extra: Partial<LearnBlock> = {}): LearnBlock =>
  ({ id, kind: "reusable", libraryId, ...extra }) as LearnBlock;

const section = (id: string, blocks: LearnBlock[], extra: Partial<LearnSection> = {}): LearnSection => ({
  id,
  label: id,
  background: "plain",
  width: "normal",
  paddingTop: "medium",
  paddingBottom: "medium",
  blocks,
  ...extra,
});

const page = (...sections: LearnSection[]): LearnPageContent => ({ seoTitle: "T", seoDescription: "", sections });

const SAVED: LearnSection = section("saved", [text("a", { anchor: "apply" }), text("b"), reuse("nested", "other")], {
  label: "Call to action",
  background: "blue",
  width: "wide",
  layout: "two-equal",
  blockColumn: { b: 1 },
  anchor: "saved-anchor",
  note: "saved note",
});
const LIBRARY = { cta: SAVED };

describe("expandReusableBlocks", () => {
  it("leaves a page with no reusable blocks equal, and the default page untouched", () => {
    expect(expandReusableBlocks(LEARN_PAGE_DEFAULT, LIBRARY)).toEqual(LEARN_PAGE_DEFAULT);
  });

  it("gives a section whose only visible block is reusable the saved section's look and blocks", () => {
    const host = section("host", [reuse("r", "cta"), text("gone", { hidden: true })], {
      label: "My CTA",
      anchor: "join",
      visibleOn: "desktop",
      background: "grey-wave",
    });
    const out = expandReusableBlocks(page(host), LIBRARY).sections[0];
    expect(out).toEqual({
      id: "host",
      label: "My CTA",
      background: "blue",
      width: "wide",
      paddingTop: "medium",
      paddingBottom: "medium",
      layout: "two-equal",
      blockColumn: { "r--b": 1 },
      anchor: "join",
      visibleOn: "desktop",
      blocks: [text("r--a", { anchor: "apply", text: "a" }), text("r--b", { text: "b" })],
    });
  });

  it("anywhere else replaces the block in place, in the same column, and keeps the host's look", () => {
    const host = section("host", [text("x"), reuse("r", "cta", { anchor: "here", visibleOn: "mobile" }), text("y")], {
      layout: "three",
      blockColumn: { r: 2, y: 1 },
    });
    const out = expandReusableBlocks(page(host), LIBRARY).sections[0];
    expect(out.background).toBe("plain");
    expect(out.blocks.map((b) => b.id)).toEqual(["x", "r--a", "r--b", "y"]);
    expect(out.blockColumn).toEqual({ y: 1, "r--a": 2, "r--b": 2 });
    // The saved block's own anchor wins; the host's anchor has no free block to land on.
    expect(out.blocks[1]).toMatchObject({ anchor: "apply", visibleOn: "mobile" });
    expect(out.blocks[2]).toMatchObject({ visibleOn: "mobile" });
  });

  it("drops hidden, missing and nested reusable blocks", () => {
    const host = section("host", [text("x"), reuse("h", "cta", { hidden: true }), reuse("m", "missing")]);
    expect(expandReusableBlocks(page(host), LIBRARY).sections[0].blocks.map((b) => b.id)).toEqual(["x"]);
    const lone = section("lone", [reuse("m", "missing")]);
    expect(expandReusableBlocks(page(lone), LIBRARY).sections[0].blocks).toEqual([]);
  });

  it("can use one saved section twice: ids stay unique and an anchor appears once", () => {
    const out = expandReusableBlocks(page(section("one", [reuse("r1", "cta")]), section("two", [reuse("r2", "cta")])), LIBRARY);
    const ids = out.sections.flatMap((s) => s.blocks.map((b) => b.id));
    expect(new Set(ids).size).toBe(ids.length);
    const anchors = out.sections.flatMap((s) => s.blocks.map((b) => b.anchor).filter(Boolean));
    expect(anchors).toEqual(["apply"]);
  });

  it("never reuses an anchor the page already has", () => {
    const out = expandReusableBlocks(page(section("s", [text("t", { anchor: "apply" }), reuse("r", "cta")])), LIBRARY);
    expect(out.sections[0].blocks.filter((b) => b.anchor === "apply")).toHaveLength(1);
  });

  it("does not change its inputs, and accepts a Map", () => {
    const input = page(section("host", [reuse("r", "cta")]));
    const before = structuredClone(input);
    const savedBefore = structuredClone(SAVED);
    const out = expandReusableBlocks(input, new Map([["cta", SAVED]]));
    expect(input).toEqual(before);
    expect(SAVED).toEqual(savedBefore);
    out.sections[0].blocks[0].id = "changed";
    expect(SAVED.blocks[0].id).toBe("a");
  });

  it("does not read inherited properties of a plain library object", () => {
    const out = expandReusableBlocks(page(section("s", [text("x"), reuse("r", "toString")])), {});
    expect(out.sections[0].blocks.map((b) => b.id)).toEqual(["x"]);
  });
});

describe("ids and references", () => {
  it("keeps expanded ids within the 64-character id format", () => {
    expect(expandedBlockId("r", "a")).toBe("r--a");
    const long = expandedBlockId("h".repeat(60), "s".repeat(60));
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(long).not.toBe(expandedBlockId("h".repeat(60), `${"s".repeat(59)}t`));
  });

  it("lists referenced saved sections and where each is used", () => {
    const p = page(section("a", [reuse("r1", "cta"), reuse("r2", "x")], { label: "Top" }), section("b", [text("t"), reuse("r3", "cta")], { label: "" }));
    expect(reusableLibraryIds(p)).toEqual(["cta", "x"]);
    expect(reusableUses(p, "cta")).toEqual(['section 1 "Top", block 1', "section 2, block 2"]);
    expect(reusableUses(null, "cta")).toEqual([]);
  });
});
