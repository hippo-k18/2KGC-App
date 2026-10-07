'use client';

import { useState, type ReactNode } from 'react';
import s from '@/app/sponsor/sponsor.module.css';

/**
 * The "Sponsor Packages" heading, its More and Info buttons, and the tiers.
 *
 * One "More" button opens every tier's benefit list at once, rather than a
 * toggle per card: the four cards share a row and are one height, and opening
 * them together keeps them one height open too (T182).
 *
 * The tiers themselves stay server-rendered and arrive as `children`; this
 * component only owns the open state.
 */
export function PackageGrid({ info, children }: { info: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className={s.packageHead}>
        <h2>Sponsor Packages</h2>
        <div className={s.packageActions}>
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
      <div id="package-grid" className={open ? `${s.tiers} ${s.isOpen}` : s.tiers}>
        {children}
      </div>
    </>
  );
}
