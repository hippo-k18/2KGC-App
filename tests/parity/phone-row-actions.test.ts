/**
 * The phone rules for a table row, asserted rather than eyeballed.
 *
 * ── Why this is a source-level test ─────────────────────────────────────────
 *
 * Everything here is either a CSS declaration or one prop on a server
 * component. There is no DOM in this suite and the dashboard's screens are
 * `'use server'` modules that reach `server-only` two imports down, so they
 * cannot be loaded by Vitest at all. `tests/parity/step-up-guard.test.ts` and
 * `storage-url.test.ts` take the same approach to the same problem, and the
 * rule they follow applies here too: a test that names a screen has to read
 * that screen, not the directory it lives in.
 *
 * ── What these pin, and what they deliberately do not ───────────────────────
 *
 * They pin the decisions a later edit would quietly undo: which elements count
 * as a row action, that a stacked row clamps a form opened inside it, which
 * tables stack, and that two screens stopped printing an internal id at an
 * organizer. They do **not** claim any element measures 32px on a real phone —
 * only a browser can say that, and it said so: every assertion below was taken
 * from a Chrome run at 390 before and after the change.
 *
 * Run with: npm test — no emulator, no Java.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const CSS = read('apps/organizer/src/app/globals.css');
const DASH = 'apps/organizer/src/app/(dash)';

/**
 * The body of the phone media query.
 *
 * Every tap-target rule in this file lives inside `@media (max-width: 767px)`,
 * and a rule that drifted out of it would change the desktop the owner asked
 * to keep. Reading the block rather than the file is what makes "on a phone"
 * part of the assertion instead of a hope.
 */
function phoneBlock(): string {
  const header = '@media (max-width: 767px) {';
  const start = CSS.indexOf(header);
  expect(start, 'globals.css has a 767px media query').toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start + header.length - 1; i < CSS.length; i += 1) {
    if (CSS[i] === '{') depth += 1;
    else if (CSS[i] === '}') {
      depth -= 1;
      if (depth === 0) return CSS.slice(start + header.length, i);
    }
  }
  throw new Error('the 767px media query is not closed');
}

const PHONE = phoneBlock();

/** The declarations of the one rule whose selector list contains `selector`. */
function ruleFor(css: string, selector: string): string {
  const at = css.indexOf(selector);
  expect(at, `a rule selects ${selector}`).toBeGreaterThan(-1);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  // Nothing between the selector and its brace may end a rule, or `at` landed
  // inside some other rule's body and this would read the wrong declarations.
  expect(css.slice(at, open)).not.toContain(';');
  return css.slice(open + 1, close);
}

describe('a row action is finger-sized on a phone, whichever of the three ways it is written', () => {
  it('gives a link or a button in a table cell a 32px box in both directions', () => {
    const rule = ruleFor(PHONE, '.whova-table-cell a,');
    // The same rule covers both, so the trailing comma above is load-bearing.
    expect(PHONE.slice(PHONE.indexOf('.whova-table-cell a,'))).toMatch(
      /^\.whova-table-cell a,\s*\.whova-table-cell button:not\(\.row-actions-btn\)\s*\{/,
    );
    expect(rule).toMatch(/min-height:\s*32px/);
    // Without this, the one-character attendee count on Categories was an 8px
    // target and the `12` on Session Feedback a 16px one.
    expect(rule).toMatch(/min-width:\s*32px/);
  });

  it('gives a `summary` the same box, since a `<details>` is the third way', () => {
    // Nine actions on Reviewers and twelve on Admin Settings were 16px tall
    // because the rule above covers `a` and `button` and a summary is neither.
    const rule = ruleFor(PHONE, '.whova-table-cell summary');
    expect(rule).toMatch(/min-height:\s*32px/);
    expect(rule).toMatch(/min-width:\s*32px/);
  });

  it('pads the summary rather than changing its display, so a triangle survives', () => {
    // A `<summary>` is a list item. `display: inline-flex` would take the
    // disclosure marker with it, and Transaction History's "Details" is the one
    // summary in the dashboard that does not hide its marker by hand.
    const rule = ruleFor(PHONE, '.whova-table-cell summary');
    expect(rule).toMatch(/padding:\s*8px 0/);
    expect(rule).not.toMatch(/display:/);
    expect(read(`${DASH}/tickets/orders-and-transactions/transaction-history/page.tsx`)).toContain(
      '<summary>Details</summary>',
    );
  });
});

describe('a form opened inside a stacked row is clamped to the row', () => {
  it('lets the disclosure and its boxes take the width of the card', () => {
    // The criterion editor on Reviewers laid out 394px wide from x=44 on a 390
    // screen — `.whova-input-lg` plus a parent sized by its own contents, where
    // a percentage `max-width` does not apply. Name, Lowest score, Highest
    // score and Save were all off the right edge with nothing to scroll to.
    const details = ruleFor(PHONE, '.whova-table.stack-rows-sm .whova-table-cell details');
    expect(details).toMatch(/width:\s*100%/);
    expect(details).toMatch(/min-width:\s*0/);

    const boxes = ruleFor(
      PHONE,
      '.whova-table.stack-rows-sm .whova-table-cell details .whova-text-input',
    );
    expect(boxes).toMatch(/width:\s*100%/);
  });

  it('leaves the desktop alone, because both rules are inside the phone query', () => {
    const outside = CSS.slice(0, CSS.indexOf('@media (max-width: 767px) {'));
    expect(outside).not.toContain('.whova-table.stack-rows-sm .whova-table-cell details');
    expect(outside).not.toContain('.whova-table-cell summary');
  });
});

describe('the tables whose row actions were behind a sideways swipe now stack', () => {
  const STACKED: { what: string; file: string; firstCol: string }[] = [
    { what: 'Logistics Center', file: `${DASH}/content/logistics-center/page.tsx`, firstCol: "label: 'Room'" },
    {
      what: 'Speaker Manager',
      file: `${DASH}/content/speaker-center/speaker-manager/page.tsx`,
      firstCol: "label: 'Speaker'",
    },
    {
      what: 'Release and Consent Forms',
      file: `${DASH}/attendees/release-and-consent-forms/page.tsx`,
      firstCol: "label: 'Form'",
    },
    { what: 'Question Forms', file: `${DASH}/tickets/question-form-screen.tsx`, firstCol: "label: 'Question'" },
  ];

  it.each(STACKED)('$what passes stackSm to the table holding its row actions', ({ file, firstCol }) => {
    const source = read(file);
    const at = source.indexOf(firstCol);
    expect(at, 'the table is still identified by its first column').toBeGreaterThan(-1);
    // `stackSm` has to be on *this* table, so look back only as far as the
    // `<Table` that owns the column list rather than anywhere in the file.
    const opening = source.lastIndexOf('<Table', at);
    expect(opening).toBeGreaterThan(-1);
    expect(source.slice(opening, at)).toContain('stackSm');
  });
});

describe('an organizer is not shown an identifier only we use', () => {
  it('Basics does not print the event id', () => {
    const source = read(`${DASH}/content/basics/page.tsx`);
    expect(source).not.toContain('EVENT_ID');
    expect(source).not.toContain('Event ID');
    // The time zone is a real setting and stays, which is the line between the
    // two: an organizer changes it, and nobody can change an event id.
    expect(read(`${DASH}/content/basics/basics-form.tsx`)).toContain('Time zone');
  });

  it('Question Forms does not print a field slug under each question', () => {
    const source = read(`${DASH}/tickets/question-form-screen.tsx`);
    expect(source).not.toContain('<code>{f.id}</code>');
  });
});

describe('the two remaining Whova form defects on Question Forms', () => {
  const editor = read(`${DASH}/tickets/question-form-editor.tsx`);

  it('the Required tick box uses the dashboard checkbox, not a bare input', () => {
    // A bare `input[type=checkbox]` renders 13px square. `.whova-checkbox-input`
    // is the 16px control whose label carries the 32px tap box.
    const at = editor.indexOf('name="required"');
    expect(at).toBeGreaterThan(-1);
    const field = editor.slice(editor.lastIndexOf('<input', at), at);
    expect(field).toContain('className="whova-checkbox-input"');
    expect(editor).toContain('<label className="whova-checkbox-label">');
  });

  it('the Required tick box has one label, not two', () => {
    // `<label htmlFor="required">Required</label>` plus a second `<label>`
    // wrapped round the control is two labels for one field.
    expect(editor).not.toContain('htmlFor="required"');
  });
});

describe('the three attendee-facing switches on Admin Settings', () => {
  it('use the dashboard checkbox too', () => {
    // Found while measuring the summaries on this screen: they were bare 13px
    // inputs, and the earlier count missed them only because the list it came
    // from stops at fifteen entries.
    const source = read(`${DASH}/attendees/admin-settings/form.tsx`);
    for (const name of ['attendeeListVisible', 'contactSharingEnabled', 'attendeeMessagingEnabled']) {
      const at = source.indexOf(`name="${name}"`);
      expect(at, `${name} is still on this form`).toBeGreaterThan(-1);
      expect(source.slice(source.lastIndexOf('<input', at), at)).toContain(
        'className="whova-checkbox-input"',
      );
    }
    expect(source).not.toMatch(/<label style=\{\{ display: 'block' \}\}>/);
  });
});

describe('the destructive action in a Categories card is quieter than Save', () => {
  it('Delete asks for the quiet variant', () => {
    const source = read(`${DASH}/attendees/categories/category-editor.tsx`);
    expect(source).toContain('whova-btn-main small danger quiet');
    expect(source).toContain('whova-btn-main small primary');
  });

  it('the quiet variant drops the fill and keeps the red', () => {
    const rule = ruleFor(CSS, '.whova-btn-main.danger.quiet');
    expect(rule).toMatch(/background-color:\s*#fff/);
    expect(rule).toMatch(/color:\s*var\(--danger\)/);
  });

  it('the count beside it says what it counts, since its text is one character', () => {
    const source = read(`${DASH}/attendees/categories/category-editor.tsx`);
    expect(source).toContain('aria-label={`${inUse} in ${c.name}`}');
  });
});
