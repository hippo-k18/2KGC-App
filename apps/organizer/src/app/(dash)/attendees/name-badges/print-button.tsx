'use client';

/**
 * The only client code on the badge and certificate sheets.
 *
 * Printing is the browser's job — `window.print()` and a `@media print` block
 * are the entire pipeline, which is why there is no PDF library, no headless
 * renderer and nothing to install on the machine at the desk. A button rather
 * than a note saying "press Ctrl+P" because the person printing badges at 07:00
 * on day one should not have to read anything.
 *
 * `label` exists because the second caller prints certificates rather than
 * badges, and a button that says "Print 40 badges" above a sheet of
 * certificates is the kind of small lie that makes somebody check whether they
 * are on the right screen.
 */
export function PrintButton({ count, label = 'badge' }: { count: number; label?: string }) {
  return (
    <button type="button" className="whova-btn-main primary" onClick={() => window.print()}>
      Print {count} {label}
      {count === 1 ? '' : 's'}
    </button>
  );
}
