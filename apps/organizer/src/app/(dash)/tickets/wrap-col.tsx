import type { ReactNode } from 'react';

/** Never binds on a desktop, where the column is narrower than 62vw already. */
const WRAP = { display: 'block', maxWidth: 'max(62vw, 240px)' } as const;

/**
 * Caps one column of long text so it wraps on a phone. A `Table` there is as
 * wide as its content, and an uncapped sentence makes it one line wide.
 */
export function wrapCol(rows: ReactNode[][], col: number): ReactNode[][] {
  return rows.map((row) =>
    row.map((cell, i) =>
      i === col ? (
        <span key={`wrap-${i}`} style={WRAP}>
          {cell}
        </span>
      ) : (
        cell
      ),
    ),
  );
}
