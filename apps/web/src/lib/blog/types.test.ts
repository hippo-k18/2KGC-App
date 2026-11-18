import { describe, expect, it } from 'vitest';
import { isFromEditor } from './types';

describe('isFromEditor', () => {
  it('is true for a post written in the editor, which never has a legacySlug', () => {
    expect(isFromEditor({})).toBe(true);
  });

  it('is false for an archive post, whatever its body has become', () => {
    expect(isFromEditor({ legacySlug: 'knowledge-graph-news-roundup-5-september-2025' })).toBe(false);
  });

  it('treats an empty legacySlug as no archive origin', () => {
    expect(isFromEditor({ legacySlug: '' })).toBe(true);
  });
});
