'use client';

import { useState, type ReactNode } from 'react';

/**
 * The "Sponsor Packages" heading, its buttons and the grid of blocks under it.
 *
 * The blocks used to open one at a time on hover, which made the hovered block
 * taller than its neighbours. One "More" button now opens every list at once,
 * so the four blocks stay the same height whether they are open or shut.
 *
 * The blocks themselves stay server-rendered and arrive as `children`; this
 * component only owns the open state.
 */
export function PackageGrid({ info, children }: { info: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="package-head">
        <h2>Sponsor Packages</h2>
        <div className="package-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            aria-expanded={open}
            aria-controls="package-grid"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Less' : 'More'}
          </button>
          {info}
        </div>
      </div>
      <div id="package-grid" className={open ? 'package-grid is-open' : 'package-grid'}>
        {children}
      </div>
    </>
  );
}
