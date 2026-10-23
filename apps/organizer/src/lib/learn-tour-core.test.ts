import { describe, expect, it } from 'vitest';
import { COVER_PAD, scrollToClear } from './learn-tour-core';

/** The outline's scrolling list at 1280x860. */
const PANE = { top: 0, bottom: 860 };

describe('tour target under a sticky bar (T326 D5b)', () => {
  it('scrolls "Add a section" up from under the Copy and Paste bar', () => {
    // Measured at 1280x860: the button at 830-860, the sticky bar at 815-860.
    const delta = scrollToClear({ top: 830, bottom: 860 }, [{ top: 815, bottom: 860 }], PANE);
    expect(delta).toBe(860 - 815 + COVER_PAD);
  });

  it('scrolls down when a bar covers the top of the target', () => {
    expect(scrollToClear({ top: 40, bottom: 70 }, [{ top: 0, bottom: 56 }], PANE)).toBe(40 - 56 - COVER_PAD);
  });

  it('leaves a target nothing covers where it is', () => {
    expect(scrollToClear({ top: 700, bottom: 730 }, [], PANE)).toBe(0);
    expect(scrollToClear({ top: 700, bottom: 730 }, [{ top: 815, bottom: 860 }], PANE)).toBe(0);
  });

  it('uses the highest bottom bar when several overlap', () => {
    expect(scrollToClear({ top: 800, bottom: 850 }, [{ top: 830, bottom: 860 }, { top: 815, bottom: 860 }], PANE, 0)).toBe(35);
  });
});
