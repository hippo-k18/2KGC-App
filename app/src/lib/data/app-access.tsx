import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { doc } from 'firebase/firestore';

import {
  APP_ACCESS_DEFAULTS,
  APP_ACCESS_KEY,
  APP_JOIN_CODE_KEY,
  COLLECTIONS,
  EVENT_ID,
  appAccessState,
  appWritesOpen,
  resolveAppAccess,
  resolveJoinCode,
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
 * switch and whether the code is asked for — and it carries nothing else from
 * `settings/access`, which also holds a note written for the check-in desk.
 * The code itself is a second document behind the ticket claim; `useJoinCode`
 * below is the only thing that reads it.
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
 * The event code, from its own document.
 *
 * ── Why this is not in the provider above ───────────────────────────────────
 *
 * The window document is readable by anybody signed in, because a closed app
 * has to be able to read the sentence that says it is closed. The code is not:
 * it sits behind the ticket claim, so that an account which holds no ticket
 * cannot read the string an organizer reads out from a stage. Two audiences,
 * two documents, and only the one screen that asks for the code subscribes to
 * the second — so nothing else in the app ever fetches it.
 *
 * An unreadable or absent document yields `''`, and `joinCodeMatches` refuses
 * everything against an empty code. `ready` is what stops that being a locked
 * door: `joinCodeRequired` lives in the other document, so between a rules
 * deploy and the first save of the settings there is a moment when the phone
 * is told to ask for a code it cannot read, and every answer would be wrong.
 * The screen uses `ready` to tell "there is no code" from "it has not arrived",
 * and lets somebody through in the first case. A prompt is a formality and
 * standing in front of an empty one is not.
 */
export function useJoinCode(): { code: string; ready: boolean } {
  const { data, status } = useDocument<string>(
    () => (isFirebaseConfigured() ? doc(getDb(), COLLECTIONS.settings, APP_JOIN_CODE_KEY) : null),
    [],
    (_id, d) => {
      const raw = d as { eventId?: unknown; values?: unknown } | undefined;
      if (!raw || raw.eventId !== EVENT_ID) return '';
      return resolveJoinCode(raw.values).joinCode;
    },
  );
  return { code: data ?? '', ready: status !== 'loading' };
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
