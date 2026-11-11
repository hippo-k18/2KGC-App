// @vitest-environment jsdom
/**
 * A form with two or more named submit buttons must not hold a control named
 * after an `HTMLFormElement` property.
 *
 * ── The bug this pins (T249) ────────────────────────────────────────────────
 *
 * On the dashboard's single-submission page, Accept, Waitlist and Reject all
 * answered "Choose accept, waitlist or reject." and recorded nothing, while the
 * bulk "Accept ticked" bar on the list page worked. Both post a `verdict` from
 * the pressed `SubmitButton`.
 *
 * React builds the action's FormData in `createFormDataWithSubmitter`: it puts a
 * temporary `<input name={submitter.name}>` beside the button and, when
 * `form.id` is truthy, gives it `form={form.id}`. The decision form carried a
 * hidden `<input name="id">`, and a named control shadows the form's own
 * property, so `form.id` was that input element. The temporary input was tied
 * to a form whose id is "[object HTMLInputElement]", left out of the FormData,
 * and the verdict never reached the server. The bulk form's field is `ids`.
 *
 * The first test runs React's own helper, read out of the copy Next.js ships,
 * so it fails if a React upgrade changes the mechanism rather than agreeing
 * with a paraphrase of it. The second scans the source for the pattern.
 *
 * Run with: npm test.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Under jsdom `import.meta.url` is not a file URL, so the path is built from `__dirname`.
const ROOT = path.resolve(__dirname, '../..');

/** `createFormDataWithSubmitter`, verbatim from Next's vendored React DOM. */
function reactHelper(): (form: HTMLFormElement, submitter: HTMLElement) => FormData {
  const file = path.join(
    ROOT,
    'apps/organizer/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js',
  );
  const src = readFileSync(file, 'utf8');
  const start = src.indexOf('function createFormDataWithSubmitter(');
  expect(start, 'React DOM no longer has createFormDataWithSubmitter').toBeGreaterThan(-1);
  const end = src.indexOf('return form;', start);
  const body = `${src.slice(start, end)}return form;}`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${body}; return createFormDataWithSubmitter;`)() as never;
}

function decisionForm(hiddenName: string): { form: HTMLFormElement; accept: HTMLButtonElement } {
  document.body.innerHTML = `
    <form>
      <input type="hidden" name="${hiddenName}" value="sub_1">
      <textarea name="note"></textarea>
      <button type="submit" name="verdict" value="accept">Accept</button>
      <button type="submit" name="verdict" value="reject">Reject</button>
    </form>`;
  const form = document.querySelector('form')!;
  /*
   * Chrome, Safari and Firefox let a named control shadow the form's own
   * property, so `form.id` is the control. jsdom does not implement that, so
   * the browser's behaviour is reproduced here; the headless Chrome run in
   * reports/T249.md is where it was observed.
   */
  const shadow = form.elements.namedItem('id');
  if (shadow) Object.defineProperty(form, 'id', { get: () => shadow });
  const accept = form.querySelector('button')!;
  return { form, accept };
}

describe('the pressed button reaches the server action', () => {
  it('is dropped when the form holds a control named id, which was the bug', () => {
    const { form, accept } = decisionForm('id');
    const data = reactHelper()(form, accept);
    expect(data.get('verdict')).toBeNull();
  });

  it('arrives when the hidden field is named submissionId, which is the fix', () => {
    const { form, accept } = decisionForm('submissionId');
    const data = reactHelper()(form, accept);
    expect(data.get('verdict')).toBe('accept');
    expect(data.get('submissionId')).toBe('sub_1');
  });
});

/**
 * The form property React reads while building the FormData. A control with
 * this name replaces it.
 */
const SHADOWING = ['id'];

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('no form with a named submit button shadows a form property', () => {
  const files = [
    ...tsxFiles(path.join(ROOT, 'apps/organizer/src')),
    ...tsxFiles(path.join(ROOT, 'apps/web/src')),
  ];

  it('finds the source to scan', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  for (const name of SHADOWING) {
    it(`has no name="${name}" field beside a named submit button`, () => {
      const offenders = files.filter((file) => {
        const src = readFileSync(file, 'utf8');
        const namedSubmit =
          /<SubmitButton\b[^>]*\bname=/.test(src) || /<button\b[^>]*type="submit"[^>]*\bname=/.test(src);
        return namedSubmit && new RegExp(`name="${name}"`).test(src);
      });
      expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
    });
  }
});
