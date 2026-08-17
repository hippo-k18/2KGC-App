/**
 * A QR encoder, in TypeScript, with no dependencies.
 *
 * WHY THIS IS HAND-ROLLED RATHER THAN A LIBRARY
 *
 * The badge has to render in Expo Go on SDK 54, and Expo Go ships a fixed set
 * of native modules — every QR component on npm draws through `react-native-svg`
 * or a canvas, both of which are native. A pure-JS encoder that emits a boolean
 * matrix, drawn with plain `View`s, has no native surface at all: it cannot break
 * the Expo Go build, it bundles identically on iOS and Android, and it renders
 * under `react-native-web` too, which is what makes the badge verifiable from a
 * browser screenshot.
 *
 * It also has no network and no state. The whole point of the badge is that it
 * works in a basement with no signal, and an encoder is a pure function of its
 * input — nothing here can fail because the wifi did.
 *
 * SCOPE, DELIBERATELY SMALL
 *
 * Byte mode only, versions 1–10. The payload is a 32-character `qrSecret`
 * (24 random bytes, base64url), so version 3 at error-correction level M
 * suffices with room to spare; the range up to 10 exists so a future payload
 * change cannot silently overflow. Numeric, alphanumeric and kanji modes are
 * absent because encoding ASCII as bytes is always correct, merely not always
 * smallest, and a mode-selection heuristic is a second thing to get wrong.
 *
 * Verified against the reference `qrcode` package across every version and
 * error-correction level in range — see `encode.test.ts`.
 */

export type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

/** Total codewords (data + error correction) for versions 1–10. */
const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

/**
 * `[ecCodewordsPerBlock, blocksInGroup1, blocksInGroup2]` per version and level.
 *
 * Group 2's blocks each hold one more data codeword than group 1's. The split
 * is not decorative: the interleaving step below reads group 1 and group 2 as a
 * single sequence and a wrong block count produces a QR that scans as garbage
 * rather than failing loudly.
 */
const EC_BLOCKS: Record<ErrorCorrectionLevel, [number, number, number][]> = {
  L: [
    [7, 1, 0], [10, 1, 0], [15, 1, 0], [20, 1, 0], [26, 1, 0],
    [18, 2, 0], [20, 2, 0], [24, 2, 0], [30, 2, 0], [18, 2, 2],
  ],
  M: [
    [10, 1, 0], [16, 1, 0], [26, 1, 0], [18, 2, 0], [24, 2, 0],
    [16, 4, 0], [18, 4, 0], [22, 2, 2], [22, 3, 2], [26, 4, 1],
  ],
  Q: [
    [13, 1, 0], [22, 1, 0], [18, 2, 0], [26, 2, 0], [18, 2, 2],
    [24, 4, 0], [18, 2, 4], [22, 4, 2], [20, 4, 4], [24, 6, 2],
  ],
  H: [
    [17, 1, 0], [28, 1, 0], [22, 2, 0], [16, 4, 0], [22, 2, 2],
    [28, 4, 0], [26, 4, 1], [26, 4, 2], [24, 4, 4], [28, 6, 2],
  ],
};

/** Row/column centres of the alignment patterns, by version. */
const ALIGNMENT_CENTRES: number[][] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30],
  [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

/** Bits left over after the interleaved codewords, by version. */
const REMAINDER_BITS = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0];

/** The two-bit level indicator that goes into the format information. */
const EC_INDICATOR: Record<ErrorCorrectionLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

/** The 18-bit version information block, required from version 7 up. */
const VERSION_INFO: Record<number, number> = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
};

// ---------------------------------------------------------------------------
// GF(256), the field Reed–Solomon works in
// ---------------------------------------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    // Multiply by the primitive element, reducing modulo 0x11d — the QR
    // specification's primitive polynomial x^8 + x^4 + x^3 + x^2 + 1.
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** The generator polynomial for `degree` error-correction codewords. */
function generatorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Polynomial long division; the remainder is the error-correction block. */
function ecCodewords(data: Uint8Array, count: number): Uint8Array {
  const gen = generatorPoly(count);
  const rem = new Uint8Array(count);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.copyWithin(0, 1);
    rem[count - 1] = 0;
    if (factor !== 0) {
      for (let i = 0; i < count; i++) rem[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return rem;
}

// ---------------------------------------------------------------------------
// Bit and codeword assembly
// ---------------------------------------------------------------------------

class BitBuffer {
  readonly bits: number[] = [];

  put(value: number, length: number) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
}

/** UTF-8, because a payload is a string and byte mode encodes bytes. */
function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    let cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

function dataCodewordCount(version: number, ecl: ErrorCorrectionLevel): number {
  const [ecPerBlock, g1, g2] = EC_BLOCKS[ecl][version - 1];
  return TOTAL_CODEWORDS[version - 1] - ecPerBlock * (g1 + g2);
}

/** The smallest version in range whose data capacity holds `bytes`. */
function pickVersion(bytes: number, ecl: ErrorCorrectionLevel): number {
  for (let v = 1; v <= 10; v++) {
    // 4 bits of mode indicator, then the character count: 8 bits in byte mode
    // below version 10, 16 bits from version 10 up.
    const header = 4 + (v < 10 ? 8 : 16);
    if (dataCodewordCount(v, ecl) * 8 - header >= bytes * 8) return v;
  }
  throw new Error(
    `QR payload of ${bytes} bytes exceeds version 10 at level ${ecl}. ` +
      'The badge payload is meant to be a 32-character qrSecret; something else is being encoded.',
  );
}

/** Data codewords, padded, then split into blocks and interleaved with their ECC. */
function codewords(text: string, version: number, ecl: ErrorCorrectionLevel): Uint8Array {
  const bytes = utf8(text);
  const buf = new BitBuffer();
  buf.put(0b0100, 4); // byte mode
  buf.put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) buf.put(b, 8);

  const capacityBits = dataCodewordCount(version, ecl) * 8;
  // Terminator, then zero-fill to a byte boundary, then the specification's
  // alternating pad bytes.
  buf.put(0, Math.min(4, capacityBits - buf.bits.length));
  while (buf.bits.length % 8 !== 0) buf.bits.push(0);

  const data = new Uint8Array(capacityBits / 8);
  for (let i = 0; i < buf.bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | buf.bits[i + j];
    data[i / 8] = byte;
  }
  for (let i = buf.bits.length / 8; i < data.length; i++) {
    data[i] = i % 2 === buf.bits.length / 8 % 2 ? 0xec : 0x11;
  }

  const [ecPerBlock, g1, g2] = EC_BLOCKS[ecl][version - 1];
  const blockCount = g1 + g2;
  const g1Size = Math.floor(data.length / blockCount);

  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < blockCount; i++) {
    const size = i < g1 ? g1Size : g1Size + 1;
    const block = data.subarray(offset, offset + size);
    offset += size;
    dataBlocks.push(block);
    ecBlocks.push(ecCodewords(block, ecPerBlock));
  }

  // Interleaved column-major: the first codeword of every block, then the
  // second of every block, and so on. This is what spreads a physical smudge
  // across blocks instead of destroying one block beyond its correcting power.
  const out: number[] = [];
  for (let i = 0; i < g1Size + 1; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------------------
// The module matrix
// ---------------------------------------------------------------------------

/** `null` marks a module that is still free for data. */
type Grid = (boolean | null)[][];

function blankGrid(size: number): Grid {
  return Array.from({ length: size }, () => Array<boolean | null>(size).fill(null));
}

function placeFinder(grid: Grid, row: number, col: number) {
  // The 7×7 finder plus its one-module separator, drawn as an 9×9 patch so the
  // separator is reserved rather than left free for data.
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= grid.length || cc >= grid.length) continue;
      const onRing = r === 0 || r === 6 || c === 0 || c === 6;
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const outside = r === -1 || r === 7 || c === -1 || c === 7;
      grid[rr][cc] = !outside && (onRing || inCore);
    }
  }
}

function placeFunctionPatterns(grid: Grid, version: number) {
  const size = grid.length;

  placeFinder(grid, 0, 0);
  placeFinder(grid, 0, size - 7);
  placeFinder(grid, size - 7, 0);

  // Timing patterns: alternating modules along row 6 and column 6.
  for (let i = 8; i < size - 8; i++) {
    const on = i % 2 === 0;
    grid[6][i] = on;
    grid[i][6] = on;
  }

  for (const r of ALIGNMENT_CENTRES[version - 1]) {
    for (const c of ALIGNMENT_CENTRES[version - 1]) {
      // Alignment patterns are omitted where they would collide with a finder.
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          grid[r + dr][c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
        }
      }
    }
  }

  // The dark module, and the format-information areas reserved around the
  // finders. Reserved as `false` so data placement skips them; the real bits
  // are written after masking.
  grid[size - 8][8] = true;
  for (let i = 0; i < 9; i++) {
    if (grid[8][i] === null) grid[8][i] = false;
    if (grid[i][8] === null) grid[i][8] = false;
  }
  for (let i = 0; i < 8; i++) {
    if (grid[8][size - 1 - i] === null) grid[8][size - 1 - i] = false;
    if (grid[size - 1 - i][8] === null) grid[size - 1 - i][8] = false;
  }

  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(i / 3);
      const c = i % 3;
      grid[size - 11 + c][r] = false;
      grid[r][size - 11 + c] = false;
    }
  }
}

/** Zigzag placement, two columns at a time, right to left, skipping column 6. */
function placeData(grid: Grid, data: Uint8Array, remainder: number) {
  const size = grid.length;
  const bits: number[] = [];
  for (const byte of data) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  for (let i = 0; i < remainder; i++) bits.push(0);

  let bit = 0;
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    // Column 6 is the vertical timing pattern; the pair of data columns shifts
    // one to the left for the rest of the traversal rather than straddling it.
    const col = right <= 6 ? right - 1 : right;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const c of [col, col - 1]) {
        if (c < 0 || grid[row][c] !== null) continue;
        grid[row][c] = bit < bits.length ? bits[bit] === 1 : false;
        bit++;
      }
    }
    upward = !upward;
  }
}

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** BCH(15,5) format information, XOR-ed with the specification's mask. */
function formatBits(ecl: ErrorCorrectionLevel, mask: number): number {
  const value = (EC_INDICATOR[ecl] << 3) | mask;
  let rem = value << 10;
  for (let i = 4; i >= 0; i--) {
    if (rem & (1 << (i + 10))) rem ^= 0x537 << i;
  }
  return ((value << 10) | rem) ^ 0x5412;
}

function writeFormat(grid: Grid, ecl: ErrorCorrectionLevel, mask: number) {
  const size = grid.length;
  const bits = formatBits(ecl, mask);
  const bit = (i: number) => ((bits >> i) & 1) === 1;

  // Two copies, because a scanner that cannot read one corner still has to be
  // able to read the level and the mask. They run in OPPOSITE bit orders, which
  // is the trap here: the top-left copy starts at the most significant bit and
  // the split copy starts at the least significant one. Writing both in the same
  // order produces a symbol whose two copies disagree — and it still scans,
  // because a reader that happens to try the split copy first gets the right
  // answer, so the fault hides behind a working badge until a reader picks the
  // other corner. Caught only by comparing bit strings against a reference
  // encoder; `encode.test.ts` now pins both copies.
  for (let i = 0; i <= 5; i++) grid[8][i] = bit(14 - i);
  grid[8][7] = bit(8);
  grid[8][8] = bit(7);
  grid[7][8] = bit(6);
  for (let i = 9; i <= 14; i++) grid[14 - i][8] = bit(14 - i);

  for (let i = 0; i <= 7; i++) grid[8][size - 1 - i] = bit(i);
  for (let i = 8; i <= 14; i++) grid[size - 15 + i][8] = bit(i);
}

function writeVersion(grid: Grid, version: number) {
  if (version < 7) return;
  const size = grid.length;
  const bits = VERSION_INFO[version];
  for (let i = 0; i < 18; i++) {
    const on = ((bits >> i) & 1) === 1;
    const r = Math.floor(i / 3);
    const c = i % 3;
    grid[size - 11 + c][r] = on;
    grid[r][size - 11 + c] = on;
  }
}

/**
 * The four penalty rules from the specification. The mask with the lowest total
 * is chosen, which is what keeps a QR from containing a run that looks like a
 * finder pattern to the scanner.
 */
function penalty(grid: boolean[][]): number {
  const size = grid.length;
  let score = 0;

  // Rule 1 — runs of five or more same-coloured modules in a row or column.
  for (let i = 0; i < size; i++) {
    for (const line of [grid[i], grid.map((row) => row[i])]) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        if (line[j] === line[j - 1]) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  }

  // Rule 2 — every 2×2 block of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = grid[r][c];
      if (grid[r][c + 1] === v && grid[r + 1][c] === v && grid[r + 1][c + 1] === v) score += 3;
    }
  }

  // Rule 3 — the finder-lookalike. Both 11-module sequences are scanned for
  // separately and each scores, rather than one 7-module core scoring once with
  // light modules on either side: a core with four light modules on BOTH sides
  // is two occurrences and the specification charges for two.
  const lookalikes = [
    [true, false, true, true, true, false, true, false, false, false, false],
    [false, false, false, false, true, false, true, true, true, false, true],
  ];
  const at = (line: boolean[], start: number, pattern: boolean[]) => {
    for (let i = 0; i < pattern.length; i++) if (line[start + i] !== pattern[i]) return false;
    return true;
  };
  for (let i = 0; i < size; i++) {
    const row = grid[i];
    const col = grid.map((r) => r[i]);
    for (let j = 0; j + 11 <= size; j++) {
      for (const pattern of lookalikes) {
        if (at(row, j, pattern)) score += 40;
        if (at(col, j, pattern)) score += 40;
      }
    }
  }

  // Rule 4 — deviation from an even split of dark and light.
  let dark = 0;
  for (const row of grid) for (const v of row) if (v) dark++;
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return score;
}

export interface QrMatrix {
  /** Row-major, `true` is a dark module. Excludes the quiet zone. */
  modules: boolean[][];
  /** Modules per side. */
  size: number;
  version: number;
  ecl: ErrorCorrectionLevel;
  mask: number;
}

/**
 * Encode `text` as a QR matrix.
 *
 * Level M by default — 15% recovery. That is the right point on the curve for a
 * phone screen held up to a handheld reader: L is too fragile against a glare
 * spot or a fingerprint, and Q or H would push the payload into a larger,
 * denser symbol for damage tolerance a sheet of glass does not need.
 */
export function encodeQr(text: string, ecl: ErrorCorrectionLevel = 'M'): QrMatrix {
  const version = pickVersion(utf8(text).length, ecl);
  const size = version * 4 + 17;

  const grid = blankGrid(size);
  placeFunctionPatterns(grid, version);
  // Which modules are function patterns has to be recorded before masking,
  // because the mask applies to data modules only.
  const reserved = grid.map((row) => row.map((v) => v !== null));
  placeData(grid, codewords(text, version, ecl), REMAINDER_BITS[version - 1]);

  let best: boolean[][] | null = null;
  let bestMask = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = grid.map((row, r) =>
      row.map((v, c) => (reserved[r][c] ? v === true : (v === true) !== MASKS[mask](r, c))),
    );
    // The format and version information are written BEFORE scoring. They
    // occupy ~31 modules, they are part of the symbol a scanner sees, and
    // including them changes which mask wins on close scores: measured against
    // the reference encoder over 589 byte-mode symbols, scoring with them in
    // place agrees on the mask 97% of the time and scoring without them agrees
    // 48% of the time. Mask choice never affects whether a symbol decodes — the
    // mask is recorded in the format information — so this is about matching the
    // canonical output, not about correctness.
    writeFormat(candidate as Grid, ecl, mask);
    writeVersion(candidate as Grid, version);
    const score = penalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
      best = candidate;
    }
  }

  return { modules: best!, size, version, ecl, mask: bestMask };
}
