import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canOpen, canRunAction } from '../../apps/organizer/src/lib/team-core';

/**
 * Tickets › HubSpot (T333) is owners only. It sits under Tickets, which the
 * finance role can open, so the role map carves it out of finance (T335, which
 * also keeps the sidebar from showing finance a link that bounces) and the
 * screen's own `requireOwner()` checks again. That second gate holds only
 * while (a) the page and every exported action call it first and (b) no other
 * screen imports the actions.
 */

const ORGANIZER = path.resolve(import.meta.dirname, '../../apps/organizer/src');
const SCREEN = path.join(ORGANIZER, 'app/(dash)/tickets/hubspot-connection-guide');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const serverFiles = readdirSync(SCREEN)
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => path.join(SCREEN, f))
  .filter((f) => /^\s*['"]use server['"]/.test(readFileSync(f, 'utf8')));

describe('the HubSpot screen’s owner gate', () => {
  it('has one action file, and every exported action calls requireOwner() first', () => {
    expect(serverFiles.map((f) => path.basename(f))).toEqual(['actions.ts']);
    const src = readFileSync(serverFiles[0], 'utf8');
    const chunks = src.split('export async function ').slice(1);
    expect(chunks.map((c) => c.slice(0, c.indexOf('('))).sort()).toEqual([
      'connectHubspotAction',
      'createKgcPropertiesAction',
      'disconnectHubspotAction',
      'loadHubspotMappingAction',
      'saveHubspotSettingsAction',
      'syncAllHubspotAction',
      'testHubspotAction',
    ]);
    for (const chunk of chunks) {
      const name = chunk.slice(0, chunk.indexOf('('));
      const firstLine = /\): Promise<.*> \{\n(.*)\n/.exec(chunk)?.[1] ?? '';
      // A read with nothing to audit has no use for the actor and calls it bare.
      expect(firstLine, name).toMatch(/^\s*(const actor = )?await requireOwner\(\);$/);
    }
    // Nothing else is exported that could be called as an action.
    expect(src).not.toMatch(/export (const|function|default|let|var) /);
  });

  it('checks the owner on the page itself before reading anything', () => {
    const page = readFileSync(path.join(SCREEN, 'page.tsx'), 'utf8');
    const body = page.slice(page.indexOf('export default async function'));
    expect(/\{\n(.*)\n/.exec(body)?.[1]).toMatch(/^\s*await requireOwner\(\);$/);
  });

  it('is imported by no screen outside tickets/hubspot-connection-guide', () => {
    const outside = walk(ORGANIZER).filter((f) => !f.startsWith(SCREEN + path.sep));
    const offenders = outside.filter((f) => /hubspot-connection-guide\/(actions|forms)['"]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('never sends the token to the browser: the forms take no token and the actions return none', () => {
    const forms = readFileSync(path.join(SCREEN, 'forms.tsx'), 'utf8');
    expect(forms).not.toMatch(/defaultValue=\{[^}]*token/i);
    const page = readFileSync(path.join(SCREEN, 'page.tsx'), 'utf8');
    // The page passes only maskToken(last4) on, and never loads the token at all.
    expect(page).not.toMatch(/<\w+[^>]*\btoken=\{token\}/);
    expect(page).not.toMatch(/loadHubspotToken/);
    const actions = readFileSync(serverFiles[0], 'utf8');
    // Every action returns HubspotState or MappingLoad, and neither shape (nor the rows inside) has room for a token.
    for (const shape of ['HubspotState', 'MappingLoad', 'MappingRow', 'SettingsValues']) {
      const body = actions.slice(actions.indexOf(`export interface ${shape}`));
      expect(body.slice(0, body.indexOf('\n}')), shape).not.toMatch(/token/i);
    }
    expect(
      actions
        .match(/export async function \w+\([^)]*\): Promise<[^>]*> \{/g)
        ?.filter((s) => !/Promise<(HubspotState|MappingLoad)>/.test(s)),
    ).toEqual([]);
  });

  it('keeps finance out by role too, so the sidebar hides the link, and requireOwner() still checks', () => {
    expect(canOpen(['finance'], 'tickets/hubspot-connection-guide')).toBe(false);
    expect(canRunAction(['finance'], ['app/(dash)/tickets/hubspot-connection-guide/page'])).toBe(false);
    // The rest of Tickets stays open to finance.
    expect(canOpen(['finance'], 'tickets/export-to-ams-crm')).toBe(true);
    expect(canOpen(['owner'], 'tickets/hubspot-connection-guide')).toBe(true);
    const auth = readFileSync(path.join(ORGANIZER, 'lib/auth.ts'), 'utf8');
    const owner = auth.slice(auth.indexOf('export async function requireOwner'));
    expect(owner.slice(0, owner.indexOf('\n}'))).toMatch(/if \(!access\.roles\.includes\('owner'\)\) redirect\(/);
  });

  it('refuses agenda, sponsors, check-in, reviews and learn by role as well', () => {
    for (const role of ['agenda', 'sponsors', 'checkin', 'reviews', 'learn'] as const) {
      expect(canOpen([role], 'tickets/hubspot-connection-guide'), role).toBe(false);
    }
  });
});

describe('the HubSpot screen after the T334 gate', () => {
  const page = readFileSync(path.join(SCREEN, 'page.tsx'), 'utf8');
  const forms = readFileSync(path.join(SCREEN, 'forms.tsx'), 'utf8');
  const actions = readFileSync(path.join(SCREEN, 'actions.ts'), 'utf8');

  it('renders from Firestore only: no HubSpot call during the page render', () => {
    expect(page).not.toMatch(/hubspot-client/);
    expect(page).not.toMatch(/listContactProperties|testHubspotToken/);
  });

  it('does not remount the mapping form on a save (that wiped the Save confirmation)', () => {
    expect(page + forms).not.toMatch(/key=\{[^}]*updatedAt/);
  });

  it('calls HubSpot from buttons with the short INTERACTIVE timeout', () => {
    for (const call of actions.match(/(listContactProperties|testHubspotToken|createContactProperty)\([^;]*\)/g) ?? []) {
      expect(call).toMatch(/INTERACTIVE/);
    }
  });

  it('never promises a retry that a button press does not make', () => {
    for (const src of [page, forms, actions]) expect(src).not.toMatch(/will try again/i);
  });

  it('kicks a drain after a good token, so changes queued while it was refused go out', () => {
    expect(actions.match(/kickDrain\(actor\)/g)?.length).toBe(2);
    expect(actions).toMatch(/drainHubspotQueue\(db\(\), \{ trigger: 'retry', actor \}\)\.catch\(/);
  });
});
