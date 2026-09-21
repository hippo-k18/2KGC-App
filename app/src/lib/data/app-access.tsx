import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { doc } from 'firebase/firestore';

import {
  APP_ACCESS_DEFAULTS,
  APP_ACCESS_KEY,
  COLLECTIONS,
  EVENT_ID,
  appAccessState,
  appWritesOpen,
  resolveAppAccess,
  type AppAccessProjection,
  type AppAccessState,
} from '@kgc/shared';

import { useDocument } from '@/lib/data/use-document';
import { getDb, isFirebaseConfigured } from '@/lib/firebase/client';

/**
 * What the organizer decided about access, on a phone.
 *
 * One document listener, mounted once inside `AuthProvider` because the rule
 * needs a signed-in reader. `settings/appAccess` is a projection written by the
 * dashboard — the access window resolved into two instants, the messaging
 * switch and the join code — and it carries nothing else from
 * `settings/access`, which also holds a note written for the check-in desk.
 *
 * ── It fails open, on purpose ───────────────────────────────────────────────
 *
 * An unread, absent or refused document leaves `APP_ACCESS_DEFAULTS`: open,
 * writable, messaging on, no code. The app *is* the schedule, and a listener
 * that has not answered yet must not lock somebody out of it in a corridor.
 * `firestore.rules` fails open in the same direction from the same document, so
 * the screen and the data agree about what an unwritten projection means.
 *
 * ── Why the clock is in state ───────────────────────────────────────────────
 *
 * The window closes at a moment, and a phone left on the home screen at 23:58
 * would otherwise still be open at 00:30 because nothing re-rendered. The tick
 * is a minute, which is as precise as a cutoff typed as a number of days
 * deserves, and it stops entirely once the app is closed — there is nothing
 * further to transition to.
 */
export interface AppAccessValue {
  access: AppAccessProjection;
  state: AppAccessState;
  /** False in read-only mode and after the window closes. */
  writesOpen: boolean;
  /** The event-wide switch. False hides every messaging affordance. */
  messagingEnabled: boolean;
}

const FALLBACK: AppAccessValue = {
  access: APP_ACCESS_DEFAULTS,
  state: 'open',
  writesOpen: true,
  messagingEnabled: true,
};

const AppAccessContext = createContext<AppAccessValue>(FALLBACK);

const TICK_MS = 60_000;

export function AppAccessProvider({ children }: { children: ReactNode }) {
  const { data } = useDocument<AppAccessProjection>(
    // Mounted above the sign-in screen, so a build with no Firebase config has
    // to fall through to the open state rather than throw out of the root.
    () => (isFirebaseConfigured() ? doc(getDb(), COLLECTIONS.settings, APP_ACCESS_KEY) : null),
    [],
    (_id, d) => merge(d),
  );

  const access = data ?? APP_ACCESS_DEFAULTS;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (access.closesAtMs === 0 && access.readOnlyFromMs === 0) return;
    if (appAccessState(access, Date.now()) === 'closed') return;
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, [access]);

  const value = useMemo<AppAccessValue>(
    () => ({
      access,
      state: appAccessState(access, now),
      writesOpen: appWritesOpen(access, now),
      messagingEnabled: access.messagingEnabled,
    }),
    [access, now],
  );

  return <AppAccessContext.Provider value={value}>{children}</AppAccessContext.Provider>;
}

export function useAppAccess(): AppAccessValue {
  return useContext(AppAccessContext);
}

/**
 * The stored document over the defaults.
 *
 * `eventId` is checked before anything is taken, the same guard
 * `lib/data/logistics.ts` applies: a projection belonging to another event is
 * not a partial answer to fall back from, and honouring its cutoff would close
 * this event on somebody else's date.
 */
function merge(d: unknown): AppAccessProjection {
  const raw = d as { eventId?: unknown; values?: unknown } | undefined;
  if (!raw || raw.eventId !== EVENT_ID) return { ...APP_ACCESS_DEFAULTS };
  return resolveAppAccess(raw.values);
}
