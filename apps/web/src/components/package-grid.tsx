import type { ReactNode } from 'react';
import s from '@/app/sponsor/sponsor.module.css';

/**
 * The "Sponsor Packages" heading, the prospectus button and the tiers under it.
 *
 * There was a "More" button here that opened every package's list at once.
 * The lists are four to six short lines each, and hiding them meant a reader
 * comparing tiers saw four one-line summaries and nothing to rank them by, so
 * they are always shown now (T179) and the button went with them. The
 * component no longer holds any state, so it is no longer a client component.
 */
export function PackageGrid({ info, children }: { info: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className={s.packageHead}>
        <h2>Sponsor Packages</h2>
        {info}
      </div>
      <div className={s.tiers}>{children}</div>
    </>
  );
}
