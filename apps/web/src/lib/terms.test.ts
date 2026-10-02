import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { oldSiteTarget } from './old-site';
import { OLD_TERMS_PATHS, TERMS_ANCHORS, termsPublished } from './terms-core';
import { parseTerms } from './terms-parse';

const OFF = {};
const ON = { TERMS_PUBLISHED: 'true' };
const FILE = readFileSync(join(import.meta.dirname, '../content/terms-2027.md'), 'utf8');

describe('TERMS_PUBLISHED', () => {
  it('is off unless set to exactly "true"', () => {
    expect(termsPublished(OFF)).toBe(false);
    for (const v of ['', '1', 'yes', 'TRUE', 'false']) expect(termsPublished({ TERMS_PUBLISHED: v })).toBe(false);
    expect(termsPublished(ON)).toBe(true);
  });
});

describe('the old terms addresses', () => {
  const paths = [...OLD_TERMS_PATHS].flatMap((p) => [p, `${p}/`]);

  it('keep going to /tickets while the terms are unpublished', () => {
    for (const p of paths) expect(oldSiteTarget(p, OFF)).toBe('/tickets');
  });

  it('go to /terms in one hop once they are published', () => {
    for (const p of paths) expect(oldSiteTarget(p, ON)).toBe('/terms');
  });

  it('are the four 2022 to 2025 terms pages, and nothing else moves', () => {
    expect(OLD_TERMS_PATHS.size).toBe(4);
    for (const p of ['/general-admission', '/kgc-23-registration-fees', '/privacy', '/terms']) {
      expect(oldSiteTarget(p, ON)).toBe(oldSiteTarget(p, OFF));
    }
    expect(oldSiteTarget('/terms', ON)).toBeNull();
  });
});

describe('the terms content file', () => {
  const doc = parseTerms(FILE);

  it('has a title and one anchor per heading, all unique', () => {
    expect(doc.title).toBeTruthy();
    const headings = doc.blocks.filter((b) => b.kind === 'heading');
    expect(doc.headingIds).toHaveLength(headings.length);
    expect(new Set(doc.headingIds).size).toBe(doc.headingIds.length);
    for (const id of doc.headingIds) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('keeps the anchors checkout and the FAQ link to', () => {
    for (const id of Object.values(TERMS_ANCHORS)) expect(doc.headingIds).toContain(id);
  });

  it('carries no draft markers and no anchor syntax into the text', () => {
    expect(FILE).not.toMatch(/\[(CHANGED|DECISION NEEDED)/);
    const text = JSON.stringify(doc.blocks);
    expect(text).not.toContain('{#');
    expect(text).not.toMatch(/"text":"#/);
  });
});

describe('parseTerms', () => {
  it('takes the # line as the title, honours {#id}, and slugs the rest', () => {
    const doc = parseTerms('# Terms\n\nIntro.\n\n## Refund policy {#refunds}\n\nText.\n\n### Virtual tickets\n\n### Virtual tickets\n');
    expect(doc.title).toBe('Terms');
    expect(doc.headingIds).toEqual(['refunds', 'virtual-tickets', 'virtual-tickets-2']);
    expect(doc.blocks[0]).toMatchObject({ kind: 'paragraph' });
  });

  it('never produces markup from the file', () => {
    const doc = parseTerms('# T\n\n<script>alert(1)</script> [x](javascript:alert(1))');
    const spans = doc.blocks.flatMap((b) => (b.kind === 'paragraph' ? b.spans : []));
    expect(spans.some((s) => s.kind === 'link')).toBe(false);
    expect(spans.map((s) => s.text).join('')).toContain('<script>');
  });
});
