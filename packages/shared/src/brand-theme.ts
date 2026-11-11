/**
 * The colours a saved brand colour turns into.
 *
 * App Branding stores two hex values. A surface cannot paint with a hex alone:
 * it needs the text colour that stays readable on it, a darker step for pressed
 * and hover states, and a pale wash for selected rows. Those are derived here,
 * once, so the website and the app arrive at the same answers.
 *
 * Returns `null` for anything that is not a six-digit hex, which is how every
 * caller falls back to its built-in palette.
 */

const HEX = /^#[0-9A-Fa-f]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex(rgb: readonly number[]): string {
  return `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** `amount` 0 returns `hex`, 1 returns `other`. */
export function mixHex(hex: string, other: string, amount: number): string {
  const a = channels(hex);
  const b = channels(other);
  return toHex(a.map((c, i) => c + (b[i] - c) * amount));
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = "#FFFFFF";
const INK = "#111111";

/** White or near-black, whichever reads better on `bg`. */
export function readableOn(bg: string): string {
  return contrastRatio(WHITE, bg) >= contrastRatio(INK, bg) ? WHITE : INK;
}

/** `color`, darkened only as far as it takes to reach `min` contrast on white. */
export function legibleOnWhite(color: string, min = 4.5): string {
  let out = color;
  for (let step = 1; step <= 10 && contrastRatio(out, WHITE) < min; step += 1) {
    out = mixHex(color, "#000000", step / 10);
  }
  return out;
}

export interface BrandPalette {
  /** The saved colour: headers, primary buttons. */
  brand: string;
  /** Text and icons on `brand`. */
  onBrand: string;
  /** Pressed and hover states, and fills that sit on `brand`. */
  brandDark: string;
  /** Selected rows and pale washes. */
  brandSoft: string;
  /** `brand`, darkened if needed, for links and icons on a white surface. */
  brandText: string;
}

export function brandPalette(brandColor: unknown): BrandPalette | null {
  if (!isHexColor(brandColor)) return null;
  const brand = brandColor.toUpperCase();
  return {
    brand,
    onBrand: readableOn(brand),
    brandDark: mixHex(brand, "#000000", 0.3),
    brandSoft: mixHex(brand, WHITE, 0.86),
    brandText: legibleOnWhite(brand),
  };
}

/** Whether white text passes WCAG AA on this colour. The dashboard warns when it does not. */
export function whiteTextPasses(color: unknown): boolean {
  return isHexColor(color) && contrastRatio(WHITE, color) >= 4.5;
}
