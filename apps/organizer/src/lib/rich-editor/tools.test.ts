import { describe, expect, it } from 'vitest';
import {
  BRAND_COLORS,
  EMOJI,
  SHORTCUTS,
  SPECIAL_CHARS,
  buildHref,
  colorHex,
  colorLabel,
  contrastRatio,
  contrastWarning,
  describeHref,
  findMatches,
  parseHex,
  platformKeys,
} from './tools';

describe('parseHex', () => {
  it('expands 3 digit colours, with or without #', () => {
    expect(parseHex('#abc')).toBe('#aabbcc');
    expect(parseHex('abc')).toBe('#aabbcc');
  });

  it('accepts 6 digit colours and lowercases them', () => {
    expect(parseHex('#AABBCC')).toBe('#aabbcc');
    expect(parseHex('112233')).toBe('#112233');
    expect(parseHex('  #112233  ')).toBe('#112233');
  });

  it('rejects junk', () => {
    for (const bad of ['', '#', 'xyz', '#12345', '#1234567', 'red', '##abc', '#ab', '#gggggg']) {
      expect(parseHex(bad)).toBeNull();
    }
  });
});

describe('colorHex / colorLabel', () => {
  it('maps brand names to hex and label', () => {
    expect(colorHex('navy')).toBe('#263759');
    expect(colorLabel('navy')).toBe('Navy');
    expect(colorLabel('light-blue')).toBe('Light blue');
    for (const b of BRAND_COLORS) expect(colorHex(b.value)).toBe(b.hex);
  });

  it('passes custom hex values through', () => {
    expect(colorHex('#123456')).toBe('#123456');
    expect(colorLabel('#ABCDEF')).toBe('#abcdef');
  });
});

describe('contrastRatio', () => {
  it('is 1 for identical colours', () => {
    expect(contrastRatio('white', 'white')).toBe(1);
  });

  it('is 21 for black on white', () => {
    expect(contrastRatio('#000000', 'white')).toBeCloseTo(21, 2);
    expect(contrastRatio('white', '#000000')).toBeCloseTo(21, 2);
  });
});

describe('contrastWarning', () => {
  it('is null for navy on white', () => {
    expect(contrastWarning('navy')).toBeNull();
    expect(contrastWarning('navy', 'white')).toBeNull();
  });

  it('warns for light blue on white', () => {
    const w = contrastWarning('light-blue', 'white');
    expect(w).not.toBeNull();
    expect(w!.includes('Hard to read') || w!.includes('Only for large text')).toBe(true);
  });

  it('warns for orange on white', () => {
    expect(contrastWarning('orange', 'white')).toEqual(expect.any(String));
  });

  it('is null for white text on navy', () => {
    expect(contrastWarning('white', 'navy')).toBeNull();
  });

  it('names the background in the hard to read message', () => {
    expect(contrastWarning('white', 'white')).toMatch(/^Hard to read: contrast 1\.0:1 against white\./);
  });
});

describe('describeHref', () => {
  it('recognises anchors', () => {
    expect(describeHref('#speakers')).toEqual({ kind: 'anchor', value: 'speakers' });
  });

  it('recognises email, dropping the query and decoding', () => {
    expect(describeHref('mailto:a@b.com')).toEqual({ kind: 'email', value: 'a@b.com' });
    expect(describeHref('MAILTO:first%2Blast@b.com?subject=Hi')).toEqual({ kind: 'email', value: 'first+last@b.com' });
  });

  it('recognises phone numbers', () => {
    expect(describeHref('tel:+12125550100')).toEqual({ kind: 'phone', value: '+12125550100' });
  });

  it('treats everything else as a url', () => {
    expect(describeHref('https://example.com')).toEqual({ kind: 'url', value: 'https://example.com' });
    expect(describeHref('/tickets')).toEqual({ kind: 'url', value: '/tickets' });
  });
});

describe('buildHref', () => {
  it('errors on empty input for every kind', () => {
    for (const kind of ['url', 'anchor', 'email', 'phone'] as const) {
      expect(buildHref(kind, '   ')).toEqual({ error: expect.any(String) });
    }
  });

  describe('anchor', () => {
    it('accepts lowercase letters, digits and dashes, with or without #', () => {
      expect(buildHref('anchor', 'day-2')).toEqual({ href: '#day-2' });
      expect(buildHref('anchor', '#day-2')).toEqual({ href: '#day-2' });
    });

    it('rejects anything else', () => {
      for (const bad of ['Day-2', 'day 2', 'day_2', 'día', '#']) {
        expect(buildHref('anchor', bad)).toEqual({ error: expect.any(String) });
      }
    });
  });

  describe('email', () => {
    it('builds mailto:, accepting an existing prefix', () => {
      expect(buildHref('email', 'a@b.com')).toEqual({ href: 'mailto:a@b.com' });
      expect(buildHref('email', 'mailto:a@b.com')).toEqual({ href: 'mailto:a@b.com' });
    });

    it('rejects non addresses', () => {
      for (const bad of ['a@b', 'ab.com', 'a b@c.com']) expect(buildHref('email', bad)).toEqual({ error: expect.any(String) });
    });
  });

  describe('phone', () => {
    it('strips spaces, brackets, dots and dashes, keeping +', () => {
      expect(buildHref('phone', '+1 (212) 555-0100')).toEqual({ href: 'tel:+12125550100' });
      expect(buildHref('phone', 'tel:020.7946.0000')).toEqual({ href: 'tel:02079460000' });
    });

    it('rejects letters and too short numbers', () => {
      for (const bad of ['call me', '123', '+1 212 555 CALL', '12+34']) {
        expect(buildHref('phone', bad)).toEqual({ error: expect.any(String) });
      }
    });
  });

  describe('url', () => {
    it('adds https:// to a bare domain', () => {
      expect(buildHref('url', 'example.com')).toEqual({ href: 'https://example.com' });
      expect(buildHref('url', 'www.example.com/a?b=1#c')).toEqual({ href: 'https://www.example.com/a?b=1#c' });
    });

    it('keeps https and relative links', () => {
      expect(buildHref('url', 'https://example.com/x')).toEqual({ href: 'https://example.com/x' });
      expect(buildHref('url', '/tickets')).toEqual({ href: '/tickets' });
    });

    it('turns a bare email into mailto:', () => {
      expect(buildHref('url', 'someone@example.com')).toEqual({ href: 'mailto:someone@example.com' });
    });

    it('warns on http://', () => {
      const r = buildHref('url', 'http://example.com');
      expect(r).toEqual({ href: 'http://example.com', warning: expect.any(String) });
    });

    it('errors on javascript: and scheme relative links', () => {
      expect(buildHref('url', 'javascript:alert(1)')).toEqual({ error: expect.any(String) });
      expect(buildHref('url', '//evil.com')).toEqual({ error: expect.any(String) });
    });

    it('errors on text that is not an address', () => {
      expect(buildHref('url', 'not a link')).toEqual({ error: expect.any(String) });
    });

    it('encodes spaces', () => {
      expect(buildHref('url', '/a b')).toEqual({ href: '/a%20b' });
    });
  });
});

describe('findMatches', () => {
  it('is case-insensitive by default', () => {
    expect(findMatches('Graph graph GRAPH', 'graph')).toEqual([
      { from: 0, to: 5 },
      { from: 6, to: 11 },
      { from: 12, to: 17 },
    ]);
  });

  it('respects matchCase', () => {
    expect(findMatches('Graph graph GRAPH', 'graph', { matchCase: true })).toEqual([{ from: 6, to: 11 }]);
  });

  it('matches whole words with unicode letters', () => {
    expect(findMatches('cafés café', 'café', { wholeWord: true })).toEqual([{ from: 6, to: 10 }]);
    expect(findMatches('cafés café', 'café')).toHaveLength(2);
    expect(findMatches('graphs graph_x graph', 'graph', { wholeWord: true })).toEqual([{ from: 15, to: 20 }]);
  });

  it('treats regex special characters as literal', () => {
    expect(findMatches('a.b axb (c) [d]', 'a.b')).toEqual([{ from: 0, to: 3 }]);
    expect(findMatches('a.b axb (c) [d]', '(c)')).toEqual([{ from: 8, to: 11 }]);
    expect(findMatches('a.b axb (c) [d]', '[d]')).toEqual([{ from: 12, to: 15 }]);
    expect(findMatches('1+1=2', '1+1')).toEqual([{ from: 0, to: 3 }]);
  });

  it('returns nothing for an empty query', () => {
    expect(findMatches('anything', '')).toEqual([]);
  });
});

describe('platformKeys', () => {
  it('uses Option on a Mac', () => {
    expect(platformKeys('Cmd+Alt+1', true)).toBe('Cmd+Option+1');
  });

  it('uses Ctrl elsewhere', () => {
    expect(platformKeys('Cmd+Shift+Z', false)).toBe('Ctrl+Shift+Z');
    expect(platformKeys('Cmd+Alt+1', false)).toBe('Ctrl+Alt+1');
  });
});

describe('character lists', () => {
  for (const [name, list] of [
    ['SPECIAL_CHARS', SPECIAL_CHARS],
    ['EMOJI', EMOJI],
  ] as const) {
    it(`${name} has no duplicate characters and every entry is named`, () => {
      const all = list.flatMap((g) => g.chars);
      expect(all.length).toBeGreaterThan(0);
      expect(new Set(all.map((c) => c.ch)).size).toBe(all.length);
      for (const c of all) {
        expect(c.ch.length).toBeGreaterThan(0);
        expect(c.name.trim().length).toBeGreaterThan(0);
      }
    });
  }

  it('SHORTCUTS is not empty', () => {
    expect(SHORTCUTS.length).toBeGreaterThan(0);
    for (const g of SHORTCUTS) expect(g.items.length).toBeGreaterThan(0);
  });
});
