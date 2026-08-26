'use client';

/**
 * The only client code on this screen.
 *
 * Printing is the browser's job — `window.print()` and a `@media print` block
 * are the entire pipeline, which is why there is no PDF library, no headless
 * renderer and nothing to install on the machine at the desk. A button rather
 * than a note saying "press Ctrl+P" because the person printing badges at 07:00
 * on day one should not have to read anything.
 */
export function PrintButton({ count }: { count: number }) {
  return (
    <button type="button" className="whova-btn-main" onClick={() => window.print()}>
      Print {count} badge{count === 1 ? '' : 's'}
    </button>
  );
}
