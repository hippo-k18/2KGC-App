import { describe, expect, it } from "vitest";
import { isSitePath } from "./site-path";

describe("isSitePath (T263)", () => {
  it("allows a path on this site", () => {
    expect(isSitePath("/tickets")).toBe(true);
    expect(isSitePath("/")).toBe(true);
    expect(isSitePath("/blog?a=1")).toBe(true);
  });
  it("refuses anything that leaves the site", () => {
    expect(isSitePath("https://evil.com")).toBe(false);
    expect(isSitePath("//evil.com")).toBe(false);
    expect(isSitePath("/\\evil.com")).toBe(false);
    expect(isSitePath("evil.com")).toBe(false);
    expect(isSitePath("")).toBe(false);
  });
});
