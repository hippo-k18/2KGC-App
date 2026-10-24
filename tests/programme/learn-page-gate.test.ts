import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canOpen, canRunAction } from '../../apps/organizer/src/lib/team-core';

/**
 * The Learn page editor's server actions are gated the way every dashboard
 * action is: `requireOrganizer()` asks `canRunAction` whether a screen the
 * caller may open imports the action. So the gate holds only while (a) every
 * exported action starts with `requireOrganizer()` and (b) no other screen
 * imports them. Both are pinned here, including `version-actions.ts`, which
 * T310 added beside T309's `actions.ts` (T313), T315's `media-actions.ts` and
 * T316's `ops-actions.ts`.
 */

const ORGANIZER = path.resolve(import.meta.dirname, '../../apps/organizer/src');
const SCREEN = path.join(ORGANIZER, 'app/(dash)/content/learn-page');
const BUNDLE = 'app/(dash)/content/learn-page/page';

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

describe('the Learn page editor’s action gate', () => {
  it('has both action files, and every exported action calls requireOrganizer() first', () => {
    // Every action file on this screen, so a new one cannot skip the check below.
    expect(serverFiles.map((f) => path.basename(f)).sort()).toEqual([
      'actions.ts',
      'media-actions.ts',
      'ops-actions.ts',
      'version-actions.ts',
    ]);
    for (const file of serverFiles) {
      const src = readFileSync(file, 'utf8');
      // Each chunk is one action; its body starts after the `): Promise<…> {` line.
      const chunks = src.split('export async function ').slice(1);
      expect(chunks.length, file).toBeGreaterThan(0);
      for (const chunk of chunks) {
        const name = chunk.slice(0, chunk.indexOf('('));
        const firstLine = /\): Promise<.*> \{\n(.*)\n/.exec(chunk)?.[1] ?? '';
        expect(firstLine, `${path.basename(file)} ${name}`).toMatch(/await requireOrganizer\(\)/);
      }
    }
  });

  it('is imported by no screen outside content/learn-page', () => {
    const outside = walk(ORGANIZER).filter((f) => !f.startsWith(SCREEN + path.sep));
    const offenders = outside.filter((f) =>
      /content\/learn-page\/(actions|version-actions|media-actions|ops-actions|api)['"]/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('lets an owner and a learn member run them, and refuses agenda, sponsors and check-in', () => {
    expect(canRunAction(['owner'], [BUNDLE])).toBe(true);
    expect(canRunAction(['learn'], [BUNDLE])).toBe(true);
    for (const role of ['agenda', 'sponsors', 'checkin', 'finance', 'reviews'] as const) {
      expect(canRunAction([role], [BUNDLE]), role).toBe(false);
      expect(canOpen([role], 'content/learn-page'), role).toBe(false);
    }
  });
});
