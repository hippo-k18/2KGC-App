'use client';

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { logoutAction, logoutEverywhereAction } from '../login/actions';
import './account-menu.css';

/**
 * Who is signed in, and the two ways out (T320).
 *
 * One menu in two places. The dashboard header carries it the way Whova's does,
 * an avatar and the address with a caret, so "Sign out" and "Sign out on all
 * devices" stop wrapping out of the 50px bar between 768 and 1179px. The Learn
 * page editor carries it too, in its own top bar: the editor covers the whole
 * window and makes the dashboard inert, so a member whose only role is the
 * Learn page had no way to sign out at all (T314 §5).
 *
 * The address comes from context, set once by the dashboard layout, so a
 * screen that renders the menu does not have to fetch or pass it.
 *
 * The forms post the same server actions the header always used. The menu is
 * kept in the DOM while closed (`hidden`), so the forms exist from the first
 * paint.
 */

const AccountContext = createContext<string | null>(null);

export function AccountProvider({ email, children }: { email: string; children: ReactNode }) {
  return <AccountContext.Provider value={email}>{children}</AccountContext.Provider>;
}

export function AccountMenu({ variant }: { variant: 'header' | 'editor' }) {
  const email = useContext(AccountContext);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  if (!email) return null;

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      close(true);
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div className={`whova-dropdown acct acct-${variant}`} ref={box}>
      <button
        ref={button}
        type="button"
        className="acct-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Account: ${email}`}
        title={email}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onButtonKey}
      >
        <span className="acct-avatar" aria-hidden="true">
          {email.charAt(0).toUpperCase()}
        </span>
        <span className="acct-email">{email}</span>
        <span className="acct-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      <div
        ref={menu}
        id={menuId}
        className="whova-menu align-end acct-menu"
        role="menu"
        aria-label="Account"
        hidden={!open}
        onKeyDown={onMenuKey}
      >
        <div className="acct-who" role="none">
          <span className="acct-who-label">Signed in as</span>
          <span className="acct-who-email">{email}</span>
        </div>
        <form action={logoutAction} role="none">
          <button type="submit" className="whova-menu-item" role="menuitem" tabIndex={-1}>
            Sign out
          </button>
          <button
            type="submit"
            formAction={logoutEverywhereAction}
            className="whova-menu-item"
            role="menuitem"
            tabIndex={-1}
          >
            Sign out on all devices
          </button>
        </form>
      </div>
    </div>
  );
}
