/**
 * The pause between a sidebar click and a screen.
 *
 * `(dash)/layout.tsx` is `force-dynamic` and awaits seven Firestore counts
 * before it paints, and every screen under it reads on the server too. Without
 * this file that is a dead frame: the previous screen stays on the glass with
 * no indication that anything is happening, which reads as a click that did not
 * register and gets clicked again.
 *
 * It is a skeleton rather than a spinner on purpose. A spinner says "wait"; the
 * skeleton says what is coming — the blue rule, the feature name, then rows —
 * so the eye is already in the right place when the real content replaces it.
 * It is also deliberately quiet: this appears on every navigation, and anything
 * with contrast or motion in it becomes the most eye-catching thing in the
 * dashboard within an hour of use.
 *
 * No colour here is literal. The bars are `--surface-alt` on `--surface`, the
 * same pair the table header and the empty state use, which is why they read as
 * furniture rather than as content that failed to load.
 *
 * `.skeleton-pulse` is optional: if `globals.css` defines it the bars breathe,
 * and if it does not they simply sit still. The layout does not depend on it.
 */

const BAR = {
  background: 'var(--surface-alt)',
  borderRadius: 3,
} as const;

/** Row widths, varied so the block reads as a list rather than as a grid. */
const ROWS = ['62%', '48%', '71%', '55%', '66%', '43%'];

export default function DashLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading">
      <div className="whova-header">
        <div className="whova-header__blue-bar" />
        <div className="whova-header__container">
          <div className="whova-header__top">
            <span className="skeleton-pulse" style={{ ...BAR, height: 24, width: 240 }} />
          </div>
          <div className="whova-header__bottom">
            <span className="skeleton-pulse" style={{ ...BAR, height: 12, width: 156 }} />
          </div>
        </div>
      </div>

      <div className="panel">
        <span
          className="skeleton-pulse"
          style={{ ...BAR, display: 'block', height: 16, marginBottom: 20, width: 180 }}
        />

        <div style={{ border: '1px solid var(--hairline)', borderRadius: 4 }}>
          <div
            style={{
              background: 'var(--surface-alt)',
              borderBottom: '1px solid var(--hairline)',
              height: 40,
            }}
          />
          {ROWS.map((width, i) => (
            <div
              key={width + i}
              style={{
                alignItems: 'center',
                borderTop: i === 0 ? undefined : '1px solid var(--hairline)',
                display: 'flex',
                height: 44,
                padding: '0 16px',
              }}
            >
              <span className="skeleton-pulse" style={{ ...BAR, height: 12, width }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
