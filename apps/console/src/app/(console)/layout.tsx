import { EVENT } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { targetDescription } from '@/lib/firestore';
import { navCounts, slimNav } from '@/lib/nav';
import { logoutAction } from '../login/actions';
import { ConsoleRail, ConsoleTabs } from './console-nav';

/**
 * The authenticated shell, shaped like Whova's: a row of top-level tabs, and a
 * left rail showing the whole sub-tree of whichever tab is selected, fully
 * expanded. Whova's dashboard is dense and utilitarian, and this matches that
 * register deliberately — an organizer moving over should be able to find
 * things by muscle memory, which they cannot do if the levels are collapsed
 * behind disclosure triangles or renamed to something tidier. The nav is
 * `src/lib/nav.ts`, which is a transcription of §1 of the research.
 *
 * Note that this gate is convenience, not security: server actions are
 * independently addressable endpoints, so every one of them calls
 * `requireOrganizer()` itself. A layout check alone protects the pixels.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireOrganizer();
  const counts = navCounts();
  const nav = slimNav();

  return (
    <>
      <nav className="topbar">
        <strong>{EVENT.shortName} console</strong>
        <span className="muted">{EVENT.name}</span>
        <span className="spacer" />
        <span className="muted">{targetDescription()}</span>
        <span className="muted">{actor}</span>
        <form action={logoutAction}>
          <button type="submit" style={{ marginTop: 0 }}>
            Sign out
          </button>
        </form>
      </nav>

      <ConsoleTabs nav={nav} />

      <div className="shell">
        <aside className="rail">
          <ConsoleRail nav={nav} />
          <p className="muted railfoot">
            {counts.implemented} of {counts.implemented + counts.placeholder} screens are real. The
            rest name the gap instead of faking it — open one to see what it would take.
          </p>
        </aside>
        <main>{children}</main>
      </div>
    </>
  );
}
