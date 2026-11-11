import { describe, expect, it } from 'vitest';
import { mainHostIndexable, siteIndexingEnabled } from './indexing-core';

describe('SITE_INDEXABLE', () => {
  it('is off unless set to exactly "true"', () => {
    expect(siteIndexingEnabled({})).toBe(false);
    expect(siteIndexingEnabled({ SITE_INDEXABLE: '1' })).toBe(false);
    expect(siteIndexingEnabled({ SITE_INDEXABLE: 'true' })).toBe(true);
  });

  it('keeps staging closed today', () => {
    expect(mainHostIndexable('staging.knowledgegraph.tech', 'https://staging.knowledgegraph.tech', {})).toBe(false);
  });

  it('opens only the configured origin once flipped', () => {
    const on = { SITE_INDEXABLE: 'true' };
    expect(mainHostIndexable('www.knowledgegraph.tech', 'https://www.knowledgegraph.tech', on)).toBe(true);
    expect(mainHostIndexable('staging.knowledgegraph.tech', 'https://www.knowledgegraph.tech', on)).toBe(false);
    expect(mainHostIndexable('142.93.180.72', 'https://www.knowledgegraph.tech', on)).toBe(false);
    expect(mainHostIndexable('www.knowledgegraph.tech', undefined, on)).toBe(false);
  });
});
