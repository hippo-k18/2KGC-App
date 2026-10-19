import { describe, expect, it } from 'vitest';
import { callTextFromPlain, callTextToPlain, fillCallTextPlaceholders } from '@kgc/shared';
import { PAGE_COPY } from '../../ops/t249-cfp-2027';
import { fillPlaceholders, PAGE_TOKENS, pageValues } from './cfp-core';

/**
 * The formatted call text (T277) fills [CLOSE DATE] and [DECISION DATE] by the
 * same rule as the plain text. Checked on the real 2027 copy, so a call that
 * Min converts in the editor drops the same sentences it drops today.
 */
describe('placeholders in formatted call text match the plain-text rule', () => {
  const bullets = (s: string) => s.replace(/^\s*[-•*]\s+/gm, '- ');
  const cases = {
    'both dates set': pageValues({ closeDate: '2027-01-31', decisionDate: '2027-02-14' }),
    'no dates set': pageValues({}),
    'only the close date': pageValues({ closeDate: '2027-01-31' }),
  };

  for (const [name, values] of Object.entries(cases)) {
    it(name, () => {
      const rich = callTextToPlain(fillCallTextPlaceholders(callTextFromPlain(PAGE_COPY), values, PAGE_TOKENS));
      expect(bullets(rich)).toBe(bullets(fillPlaceholders(PAGE_COPY, values)));
    });
  }
});
