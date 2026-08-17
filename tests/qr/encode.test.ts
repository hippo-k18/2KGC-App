/**
 * Tests for the badge QR encoder.
 *
 * The encoder is hand-rolled — see the header of `app/src/lib/qr/encode.ts` for
 * why — so it needs a reference to be right against, not merely self-consistent.
 * Every expected value below was produced by the `qrcode` npm package, which is
 * deliberately NOT a dependency of this repo: it is the independent oracle, and
 * making it a dependency would let a shared bug agree with itself.
 *
 * A wrong QR here is invisible in review and invisible in a screenshot. It fails
 * at the door, in front of a queue, with no diagnostic beyond "it didn't beep" —
 * which is why the goldens are whole matrices rather than a smoke test.
 *
 * Run with: npm test
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { encodeQr, type ErrorCorrectionLevel } from '../../app/src/lib/qr/encode';

/** Render a matrix the way the goldens below are written. */
const render = (modules: boolean[][]) =>
  modules.map((row) => row.map((on) => (on ? '#' : '.')).join(''));

const sha = (modules: boolean[][]) =>
  createHash('sha256').update(render(modules).join('\n')).digest('hex').slice(0, 32);

/**
 * The payload shape that actually ships: 32 characters of base64url, which is
 * what `qrSecret()` produces from 24 random bytes.
 */
const SECRET = 'gN8Xk2pQvR7mZ4tLbY6wA1sD3fH5jK9c';

/**
 * Deterministic filler that the reference encoder also encodes as bytes. Plain
 * `'A'.repeat(n)` would be encoded in alphanumeric mode by any encoder that
 * implements it, so it cannot be compared against a byte-mode-only encoder.
 */
const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => 'aZ9.-_'[i % 6]).join('');

describe('the badge QR encoder', () => {
  /**
   * A full matrix, module for module, against the reference encoder.
   *
   * This is the test that would have caught the real bug found while writing
   * this file: the top-left copy of the format information runs most-significant
   * bit first and the split copy runs least-significant bit first. Writing both
   * in the same order still produces a symbol that many readers decode, because
   * they happen to try the split copy, so the fault survives every "I scanned it
   * and it worked" check.
   */
  it('matches the reference encoder exactly at level M', () => {
    const qr = encodeQr(SECRET, 'M');
    expect(qr.version).toBe(3);
    expect(qr.size).toBe(29);
    expect(qr.mask).toBe(2);
    expect(render(qr.modules)).toEqual([
      '#######.....####...##.#######',
      '#.....#.....#######.#.#.....#',
      '#.###.#.######.#......#.###.#',
      '#.###.#.#.##..##....#.#.###.#',
      '#.###.#.#.###..##.##..#.###.#',
      '#.....#.##.#........#.#.....#',
      '#######.#.#.#.#.#.#.#.#######',
      '........####..#.#.#..........',
      '#.#####...###...###...#####..',
      '.##....##.#..###....#..##.#..',
      '#.#.#.##.#..#######.#####....',
      '..##....##.#.#.#...#####.#.#.',
      '###.#.#.#.##..##.#..##....###',
      '.##..#.####.#..##.###.###.#.#',
      '#.###.###..##....#.....#.###.',
      '.#.##..#.#.##.#.#.####.##..##',
      '#...#.#.#.##........#..#.##.#',
      '##..#..#.#.#.###.###..#.#..#.',
      '#.....####...####.#.#.....#..',
      '#.#.#....#.#.#....#..#..##..#',
      '#.##.##...##..##.##########..',
      '........#...#...#..##...#..##',
      '#######..#.....##...#.#.#....',
      '#.....#.#####.##...##...##.#.',
      '#.###.#.#..#....##..######.#.',
      '#.###.#.#.#.###..##.#..##..##',
      '#.###.#.#....#.####..#.###.#.',
      '#.....#....###....#.#.#..#.#.',
      '#######.#..........#.#.####..',
    ]);
  });

  it('matches the reference encoder at level L', () => {
    const qr = encodeQr(SECRET, 'L');
    expect([qr.version, qr.size, qr.mask]).toEqual([2, 25, 4]);
    expect(render(qr.modules)).toEqual([
      '#######.##......#.#######',
      '#.....#.##..###...#.....#',
      '#.###.#.##....#.#.#.###.#',
      '#.###.#.#.#..#.##.#.###.#',
      '#.###.#..###.#.##.#.###.#',
      '#.....#.#.........#.....#',
      '#######.#.#.#.#.#.#######',
      '.........#.##..#.........',
      '##..###..##....#...#.####',
      '#.###...#..###..###.#.##.',
      '..##.###..##.#####..####.',
      '.####...##.#..##.###..###',
      '#....###...###..#.#..#.#.',
      '##.#.#...#...#####..#.#.#',
      '...#.###...#...##..#.##..',
      '....#..#..#.#.##..#...#.#',
      '##..###.....#.#.#####.###',
      '........##.#.#.##...#.#..',
      '#######..#.##...#.#.#....',
      '#.....#.#.....###...####.',
      '#.###.#.#.......#######.#',
      '#.###.#...####..###.#....',
      '#.###.#..###.#.#.###.#.#.',
      '#.....#.#..##.#.#.#...##.',
      '#######.#.#.##.#.########',
    ]);
  });

  it('matches the reference encoder at level Q', () => {
    const qr = encodeQr(SECRET, 'Q');
    expect([qr.version, qr.size, qr.mask]).toEqual([3, 29, 6]);
    expect(sha(qr.modules)).toBe('bd561a7c0fb71a65467518e88617de02');
  });

  it('matches the reference encoder at level H', () => {
    const qr = encodeQr(SECRET, 'H');
    expect([qr.version, qr.size, qr.mask]).toEqual([4, 33, 6]);
    expect(sha(qr.modules)).toBe('ad14868976cef68ca1da972924a683c5');
  });

  it('matches the reference encoder on the smallest symbol', () => {
    const qr = encodeQr('kgc', 'M');
    expect([qr.version, qr.size, qr.mask]).toEqual([1, 21, 6]);
    expect(render(qr.modules)).toEqual([
      '#######.#.##..#######',
      '#.....#.#..##.#.....#',
      '#.###.#.##..#.#.###.#',
      '#.###.#.....#.#.###.#',
      '#.###.#.#####.#.###.#',
      '#.....#..#....#.....#',
      '#######.#.#.#.#######',
      '.........#...........',
      '#..######.##.#..#.###',
      '#####...######.####..',
      '#.#..##...###..#...##',
      '....##....#.#####.###',
      '.#.##.############.#.',
      '........###.###...##.',
      '#######.#..#.....#...',
      '#.....#.##....#...##.',
      '#.###.#.#.#..##.###.#',
      '#.###.#.#.#.#####....',
      '#.###.#..#.###.###.##',
      '#.....#..#.##..#.#.##',
      '#######.###.##.##.#..',
    ]);
  });

  /**
   * Versions 7 and up carry an extra 18-bit version-information block in two
   * places, and versions 10 and up switch the character count from 8 bits to 16.
   * Both are tables that are easy to get subtly wrong and impossible to notice
   * on a 32-character payload, which never reaches either.
   */
  it('gets the version-information block right for versions 7 to 10', () => {
    const expected: [number, number, number, string][] = [
      [115, 7, 45, 'beceac8476234649c7b4c601fd03fac4'],
      [130, 8, 49, '80d4503e77579a8076c5e3914475bac2'],
      [160, 9, 53, 'c5e0c16f4f205817d67661f3475d80c3'],
      // Version 10 is also where the 16-bit character count begins.
      [200, 10, 57, '91742dc618099abe0afba67d51f0325d'],
    ];
    for (const [length, version, size, digest] of expected) {
      const qr = encodeQr(filler(length), 'M');
      expect([length, qr.version, qr.size]).toEqual([length, version, size]);
      expect(sha(qr.modules)).toBe(digest);
    }
  });

  /**
   * The two copies of the format information must agree. They are written in
   * opposite bit orders, so a mistake in either mapping produces a symbol whose
   * corners disagree — which decodes for whichever reader picks the good corner
   * and fails silently for the other.
   */
  it('writes the same format information into both copies', () => {
    for (const ecl of ['L', 'M', 'Q', 'H'] as ErrorCorrectionLevel[]) {
      const { modules, size } = encodeQr(SECRET, ecl);
      const topLeft: number[] = [];
      for (let i = 0; i <= 5; i++) topLeft[14 - i] = modules[8][i] ? 1 : 0;
      topLeft[8] = modules[8][7] ? 1 : 0;
      topLeft[7] = modules[8][8] ? 1 : 0;
      topLeft[6] = modules[7][8] ? 1 : 0;
      for (let i = 9; i <= 14; i++) topLeft[14 - i] = modules[14 - i][8] ? 1 : 0;

      const split: number[] = [];
      for (let i = 0; i <= 7; i++) split[i] = modules[8][size - 1 - i] ? 1 : 0;
      for (let i = 8; i <= 14; i++) split[i] = modules[size - 15 + i][8] ? 1 : 0;

      expect(topLeft.join(''), `format info copies disagree at level ${ecl}`).toBe(split.join(''));
    }
  });

  /** The finder patterns and the dark module, which orient every scanner. */
  it('places the three finders and the dark module', () => {
    const { modules, size } = encodeQr(SECRET, 'M');
    for (const [top, left] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ]) {
      expect(modules[top][left]).toBe(true);
      expect(modules[top + 1][left + 1]).toBe(false);
      expect(modules[top + 3][left + 3]).toBe(true);
    }
    expect(modules[size - 8][8]).toBe(true);
  });

  it('refuses a payload it cannot encode rather than truncating one', () => {
    // Silent truncation would produce a scannable badge for the wrong person.
    expect(() => encodeQr(filler(400), 'M')).toThrow(/exceeds version 10/);
  });
});
