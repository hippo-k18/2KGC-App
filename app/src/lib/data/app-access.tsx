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

import { useAuth } from '@/lib/auth/auth-provider';
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
  /*
   * Keyed on the uid, and that is the whole feature working or not working.
   *
   * The rule on `settings/appAccess` asks for a signed-in reader, and this
   * provider is mounted above the sign-in screen — so on a cold launch the
   * listener was created signed out, refused, and, with `[]` for deps, never
   * built again. It came back only on a full reload with a session already in
   * place. Every attendee signs in at least once, and on that session the
   * projection stayed at the defaults: no join code was asked for, the
   * messaging switch read as on however it was set, and the access window never
   * closed. All three round-two settings were invisible on the one session that
   * matters, and each looked like a dashboard that had not saved.
   *
   * `user` rather than `uid`: signing out has to tear the listener down too,
   * or it takes a `permission-denied` the moment the credential dies.
   */
  const { user } = useAuth();
  const { data } = useDocument<AppAccessProjection>(
    // A build with no Firebase config falls through to the open state rather
    // than throwing out of the root.
    () =>
      isFirebaseConfigured() && user
        ? doc(getDb(), COLLECTIONS.settings, APP_ACCESS_KEY)
        : null,
    [user?.uid],
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
  /*
   * Keyed on the uid for the same reason the provider above is: this document
   * is behind the ticket claim, and a listener built before there is a token is
   * a listener that is refused once and never retried.
   *
   * ── Why the claim is not in the deps, although it can move ──────────────────
   *
   * The ticket claim is minted on an account that already exists — the
   * dashboard does it when a ticket is transferred in, or an attendee is
   * reinstated — and a new token carrying it does not change the uid, so
   * nothing here resubscribes. That would matter if this listener could be
   * standing when the claim arrives, and it cannot: the screen that calls this
   * hook is rendered only when `joinCodeNeeded` sees a `users/{uid}` profile,
   * and the rules let only a ticket holder create one. The claim is on the
   * server before this listener exists. Losing the claim revokes the refresh
   * tokens with it, so that session ends rather than sitting here refused.
   *
   * And a refusal would not strand the screen in any case. A denied stream
   * settles as an error rather than staying in `loading`, so `ready` is true
   * with an empty code, which is the "nothing to ask" path the screen already
   * documents. `ready` is false only while the document has genuinely not
   * answered yet, which is the one thing it is there to say.
   */
  const { user } = useAuth();
  const { data, status } = useDocument<string>(
    () =>
      isFirebaseConfigured() && user
        ? doc(getDb(), COLLECTIONS.settings, APP_JOIN_CODE_KEY)
        : null,
    [user?.uid],
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
