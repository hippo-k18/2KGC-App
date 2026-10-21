'use client';

import { Fragment, useState } from 'react';
import { Modal } from './dialogs';
import './tools.css';

/**
 * The editor's keyboard shortcuts (T318), in one list that the dialog shows
 * and the shell's key handler is documented against, so the two cannot drift.
 *
 * Each entry in `keys` is one way to do it, written as `+`-joined tokens.
 * `Mod` is Command on a Mac and Ctrl elsewhere. Cmd+H is not used because
 * macOS hides the whole browser window with it.
 */
export const SHORTCUTS: { keys: string[]; label: string; group: string }[] = [
  { group: 'Editing', keys: ['Mod+S'], label: 'Save' },
  { group: 'Editing', keys: ['Mod+Z'], label: 'Undo' },
  { group: 'Editing', keys: ['Shift+Mod+Z'], label: 'Redo' },
  { group: 'Editing', keys: ['Mod+C'], label: 'Copy the selected block or section' },
  { group: 'Editing', keys: ['Mod+X'], label: 'Cut' },
  { group: 'Editing', keys: ['Mod+V'], label: 'Paste' },
  { group: 'Editing', keys: ['Mod+D'], label: 'Duplicate' },
  { group: 'Editing', keys: ['Delete', 'Backspace'], label: 'Delete what is selected' },
  { group: 'Editing', keys: ['Shift+Mod+H'], label: 'Hide or show on the website' },

  { group: 'Outline', keys: ['Alt+Up', 'Alt+Down'], label: 'Move up or down' },
  { group: 'Outline', keys: ['Shift+Click', 'Mod+Click'], label: 'Select several' },
  { group: 'Outline', keys: ['Mod+A'], label: 'Select every block in the section' },
  { group: 'Outline', keys: ['/'], label: 'Add a block' },

  { group: 'Tools', keys: ['Mod+F'], label: 'Find and replace' },
  { group: 'Tools', keys: ['Shift+Mod+K'], label: 'Check the page' },
  { group: 'Tools', keys: ['Shift+Mod+M'], label: 'Open the media library' },

  { group: 'Preview', keys: ['Mod+='], label: 'Zoom in' },
  { group: 'Preview', keys: ['Mod+-'], label: 'Zoom out' },
  { group: 'Preview', keys: ['Mod+0'], label: 'Reset the zoom' },
  { group: 'Preview', keys: ['Shift+Mod+1'], label: 'Desktop width' },
  { group: 'Preview', keys: ['Shift+Mod+2'], label: 'Tablet width' },
  { group: 'Preview', keys: ['Shift+Mod+3'], label: 'Phone width' },

  { group: 'General', keys: ['Mod+/', '?'], label: 'Show these shortcuts' },
  { group: 'General', keys: ['Escape'], label: 'Close, or go up one level' },
];

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

/** What each token looks like on the key cap, and what a screen reader should say. */
function keyCap(token: string, mac: boolean): { cap: string; spoken: string } {
  switch (token) {
    case 'Mod':
      return mac ? { cap: '⌘', spoken: 'Command' } : { cap: 'Ctrl', spoken: 'Control' };
    case 'Shift':
      return mac ? { cap: '⇧', spoken: 'Shift' } : { cap: 'Shift', spoken: 'Shift' };
    case 'Alt':
      return mac ? { cap: '⌥', spoken: 'Option' } : { cap: 'Alt', spoken: 'Alt' };
    case 'Up':
      return { cap: '↑', spoken: 'Up arrow' };
    case 'Down':
      return { cap: '↓', spoken: 'Down arrow' };
    case 'Delete':
      return { cap: mac ? '⌦' : 'Delete', spoken: 'Delete' };
    case 'Backspace':
      return { cap: mac ? '⌫' : 'Backspace', spoken: 'Backspace' };
    case 'Escape':
      return { cap: 'Esc', spoken: 'Escape' };
    case 'Click':
      return { cap: 'click', spoken: 'click' };
    case '=':
      return { cap: '=', spoken: 'equals' };
    case '-':
      return { cap: '-', spoken: 'minus' };
    case '/':
      return { cap: '/', spoken: 'slash' };
    case '?':
      return { cap: '?', spoken: 'question mark' };
    default:
      return { cap: token, spoken: token };
  }
}

/** Modifiers in each platform's usual order: Shift before Command on a Mac, Ctrl first elsewhere. */
function orderTokens(combo: string, mac: boolean): string[] {
  const parts = combo.split(/\+(?!$)/);
  const rank = mac ? ['Alt', 'Shift', 'Mod'] : ['Mod', 'Alt', 'Shift'];
  const mods = parts.filter((p) => rank.includes(p)).sort((a, b) => rank.indexOf(a) - rank.indexOf(b));
  return [...mods, ...parts.filter((p) => !rank.includes(p))];
}

/** A shortcut as plain text, for a button's title: "⇧⌘K" on a Mac, "Ctrl+Shift+K" elsewhere. */
export function shortcutText(combo: string, mac: boolean): string {
  const caps = orderTokens(combo, mac).map((t) => keyCap(t, mac).cap);
  if (!mac) return caps.join('+');
  // Mac symbols run together, but a word after them (click) reads better spaced.
  return caps.reduce((out, c) => (out && c.length > 1 ? `${out} ${c}` : out + c), '');
}

function Combo({ combo, mac }: { combo: string; mac: boolean }) {
  const tokens = orderTokens(combo, mac);
  return (
    <kbd className="le-tools-combo">
      {tokens.map((t, i) => {
        const { cap, spoken } = keyCap(t, mac);
        return (
          <Fragment key={`${t}-${i}`}>
            {!mac && i > 0 && (
              <span className="le-tools-plus" aria-hidden="true">
                +
              </span>
            )}
            {t === 'Click' ? (
              <span className="le-tools-click">{cap}</span>
            ) : (
              <kbd>
                <span aria-hidden="true">{cap}</span>
                <span className="le-tools-sr">{spoken}</span>
              </kbd>
            )}
          </Fragment>
        );
      })}
    </kbd>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  // Read once on open; the dialog only ever renders in the browser.
  const [mac] = useState(isMacPlatform);
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];

  return (
    <Modal
      title="Keyboard shortcuts"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-default" onClick={onClose} data-autofocus>
          Close
        </button>
      }
    >
      <div className="le-tools-shortcuts">
        {groups.map((g) => (
          <table key={g} className="le-tools-keys">
            <caption>{g}</caption>
            <thead className="le-tools-sr">
              <tr>
                <th scope="col">Action</th>
                <th scope="col">Keys</th>
              </tr>
            </thead>
            <tbody>
              {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                <tr key={s.label}>
                  <th scope="row">{s.label}</th>
                  <td>
                    {s.keys.map((k, i) => (
                      <Fragment key={k}>
                        {i > 0 && <span className="le-tools-or">or</span>}
                        <Combo combo={k} mac={mac} />
                      </Fragment>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
      <p className="le-muted le-tools-keys-note">Outline shortcuts work while the outline has focus.</p>
    </Modal>
  );
}
