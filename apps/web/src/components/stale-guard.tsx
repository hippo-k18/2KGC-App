'use client';

import { useCallback, useEffect, useState, type ReactNode, type RefObject } from 'react';
import { SITE } from '@/lib/site';
import {
  draftKey,
  isStaleActionError,
  keepsField,
  readDraft,
  reloadedRecently,
  type SavedDraft,
} from '@/lib/stale-action-core';

/**
 * Keeps a public form working across a deploy (T379). See `lib/stale-action-core.ts`.
 *
 * When the server no longer knows the form's action, what was typed goes to
 * `sessionStorage` (this tab only, gone when it closes), the page reloads once
 * to pick up the new build, and the fields are filled back in with a line
 * saying to press the button again. It does not resend by itself: the person
 * should see what is about to go before it goes.
 */

type Notice = 'reloaded' | 'failed' | null;
type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function controls(form: HTMLFormElement): Control[] {
  return Array.from(form.elements).filter(
    (el): el is Control =>
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) &&
      keepsField({ name: el.name, type: el.type, keep: el.hasAttribute('data-keep') }),
  );
}

function collect(form: HTMLFormElement): Record<string, string[]> {
  const values: Record<string, string[]> = {};
  for (const el of controls(form)) {
    const list = (values[el.name] ??= []);
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      if (el.checked) list.push(el.value);
    } else if (el instanceof HTMLSelectElement && el.multiple) {
      for (const o of Array.from(el.selectedOptions)) list.push(o.value);
    } else {
      list.push(el.value);
    }
  }
  return values;
}

/**
 * Sets a value the way typing would, so a controlled field (the CFP form's
 * session type, which decides which questions show) updates its React state
 * rather than being put back on the next render.
 */
function setLikeTyping(el: Control, value: string) {
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function setCheckedLikeClicking(el: HTMLInputElement, checked: boolean) {
  if (el.checked === checked) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
  if (setter) setter.call(el, checked);
  else el.checked = checked;
  el.dispatchEvent(new Event('click', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Fills in what it can find now; returns the names not on the page yet. */
function fill(form: HTMLFormElement, values: Record<string, string[]>): Record<string, string[]> {
  const missing: Record<string, string[]> = {};
  const byName = new Map<string, Control[]>();
  for (const el of controls(form)) byName.set(el.name, [...(byName.get(el.name) ?? []), el]);
  for (const [name, wanted] of Object.entries(values)) {
    const els = byName.get(name);
    if (!els?.length) {
      missing[name] = wanted;
      continue;
    }
    els.forEach((el, i) => {
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
        setCheckedLikeClicking(el, wanted.includes(el.value));
      } else if (el instanceof HTMLSelectElement && el.multiple) {
        for (const o of Array.from(el.options)) o.selected = wanted.includes(o.value);
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el.value !== (wanted[i] ?? '')) {
        setLikeTyping(el, wanted[i] ?? '');
      }
    });
  }
  return missing;
}

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function save(form: HTMLFormElement, key: string, reloadedAt?: number) {
  const draft: SavedDraft = { at: Date.now(), values: collect(form), reloadedAt };
  try {
    store()?.setItem(key, JSON.stringify(draft));
  } catch {
    // A full or blocked store: the reload still fixes the page, the text is lost.
  }
}

/** Next's own redirect and not-found signals pass straight through. */
function isNavigation(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_');
}

export type StaleGuard = ReturnType<typeof useStaleGuard>;

/**
 * `enabled` is false only inside `KeepTypedForm` when a parent already runs
 * the guard for the same form, so one draft is not put back twice.
 */
export function useStaleGuard(
  formRef: RefObject<HTMLFormElement | null>,
  again = 'please press Send again',
  enabled = true,
  formName = 'form',
) {
  const [notice, setNotice] = useState<Notice>(null);

  // Put back a draft saved before the reload, including fields that only
  // appear once an earlier one is set (a workshop's outline after its type).
  useEffect(() => {
    if (!enabled) return;
    const s = store();
    const key = draftKey(window.location.pathname, formName);
    const draft = readDraft(s?.getItem(key) ?? null, Date.now());
    if (!draft) return;
    // Kept until the next save or the tab closes, so a second stale press can
    // tell it already reloaded once. Only the values are dropped once used.
    try {
      s?.setItem(key, JSON.stringify({ ...draft, values: {} }));
    } catch {}
    if (Object.keys(draft.values).length === 0) return;
    setNotice(draft.reloadedAt ? 'reloaded' : 'failed');
    let left = draft.values;
    let frames = 0;
    const step = () => {
      const form = formRef.current;
      if (form) left = fill(form, left);
      if (Object.keys(left).length && ++frames < 5) requestAnimationFrame(step);
    };
    step();
  }, [formRef, enabled, formName]);

  /** What to do with an error from the action. True when it was handled here. */
  const recover = useCallback(
    (err: unknown, { anyError }: { anyError: boolean }): 'reloading' | 'shown' | 'rethrow' => {
      if (isNavigation(err)) return 'rethrow';
      const form = formRef.current;
      const stale = isStaleActionError(err);
      if (!form || (!stale && !anyError)) return 'rethrow';
      const now = Date.now();
      const key = draftKey(window.location.pathname, formName);
      const previous = readDraft(store()?.getItem(key) ?? null, now);
      if (stale && !reloadedRecently(previous, now)) {
        save(form, key, now);
        window.location.reload();
        return 'reloading';
      }
      save(form, key, previous?.reloadedAt);
      setNotice('failed');
      return 'shown';
    },
    [formRef, formName],
  );

  /** For a plain action, `(formData) => Promise`. Any failure leaves the text and a line saying so. */
  const guardAction = useCallback(
    <A extends unknown[]>(fn: (...args: A) => unknown) =>
      async (...args: A): Promise<void> => {
        setNotice(null);
        try {
          await fn(...args);
        } catch (err) {
          const r = recover(err, { anyError: true });
          if (r === 'rethrow') throw err;
          if (r === 'reloading') await new Promise(() => {});
        }
      },
    [recover],
  );

  /** For a `useActionState` action, `(prev, formData) => Promise<state>`. Only the stale case is caught. */
  const guardState = useCallback(
    <S, P>(fn: (prev: S, payload: P) => Promise<S>) =>
      async (prev: S, payload: P): Promise<S> => {
        try {
          return await fn(prev, payload);
        } catch (err) {
          const r = recover(err, { anyError: false });
          if (r === 'rethrow') throw err;
          if (r === 'reloading') await new Promise(() => {});
          return prev;
        }
      },
    [recover],
  );

  const view: ReactNode =
    notice === 'reloaded' ? (
      <p className="notice warn" role="alert">
        The page was updated while you had it open. Your text is kept, {again}.
      </p>
    ) : notice === 'failed' ? (
      <p className="notice bad" role="alert">
        <strong>That did not send.</strong> Your text is kept, {again}. If it keeps failing, email{' '}
        <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
      </p>
    ) : null;

  return { notice: view, guardAction, guardState };
}
