import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { AGENDA, LEARN, OWNER } from './people';
import { DASH, cookieFor, fsDelete, fsGet, fsList, fsSet, storageClear, storageList } from './helpers';

/**
 * The role gate on every Learn page server action (T315, T316, T323).
 *
 * Next runs an action id wherever it is posted, so an agenda-only member
 * posts each action's real id (read from the build's action manifest) both at
 * the Learn page and at a screen they may open, with plausible arguments.
 * Every call must be refused, and Firestore and Storage must not change.
 * A learn-only member's call is the control: the same request shape works.
 */

const DIST = process.env.ORGANIZER_DIST_DIR ?? '.next-t323-e2e';
const MANIFEST = path.resolve(__dirname, '../../../apps/organizer', DIST, 'server/server-reference-manifest.json');
const ACTION_FILES = /content\/learn-page\/(actions|media-actions|ops-actions|version-actions)\.ts$/;
const CANARY = 'CANARYW-learn-gate';

function learnActions(): Map<string, string> {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
    node: Record<string, { workers: Record<string, { moduleId: string }>; filename?: string; exportedName?: string }>;
  };
  const out = new Map<string, string>();
  for (const [id, entry] of Object.entries(manifest.node)) {
    // A production build names each action on its entry; a dev build only inside the loader's query string.
    if (entry.filename && entry.exportedName) {
      if (ACTION_FILES.test(entry.filename)) out.set(entry.exportedName, id);
      continue;
    }
    for (const w of Object.values(entry.workers)) {
      const query = new URLSearchParams(w.moduleId.split('?')[1]?.replace(/!$/, '') ?? '');
      const list = JSON.parse(query.get('actions') ?? '[]') as [string, { id: string; exportedName: string; filename: string }[]][];
      for (const [, actions] of list) for (const a of actions) if (ACTION_FILES.test(a.filename)) out.set(a.exportedName, a.id);
    }
  }
  return out;
}

const section = (label: string) => ({
  id: 's-gate',
  label,
  background: 'plain',
  width: 'normal',
  paddingTop: 'medium',
  paddingBottom: 'medium',
  blocks: [{ id: 'b-gate', kind: 'text', text: `${label} text` }],
});
const page = (label: string) => ({ seoTitle: 'Gate', seoDescription: 'Gate', sections: [section(label)] });

/** Plausible arguments for each action, so a refusal is the gate and not a malformed call. */
function argsFor(name: string, revision: number): unknown[] {
  switch (name) {
    case 'saveLearnDraftAction':
      return [page('HACKED'), revision];
    case 'publishLearnPageAction':
      return [{ baseRevision: revision, content: page('HACKED') }];
    case 'restoreLearnVersionAction':
    case 'loadLearnVersionAction':
      return ['v-gate'];
    case 'listLearnMediaAction':
      return [{}];
    case 'learnMediaUsesAction':
    case 'deleteLearnMediaAction':
      return ['m-gate'];
    case 'updateLearnMediaAction':
      return ['m-gate', { fileName: 'HACKED' }];
    case 'saveLearnLibraryItemAction':
      return [{ name: 'HACKED', section: section('HACKED') }];
    case 'renameLearnLibraryItemAction':
      return ['l-gate', 'HACKED'];
    case 'deleteLearnLibraryItemAction':
      return ['l-gate'];
    case 'scheduleLearnPublishAction':
      return [Date.now() + 3 * 3600e3, revision];
    case 'editLearnImageAction':
      return [{ src: '/kgc/wave-3.png', edit: { ops: [{ op: 'rotate', degrees: 90 }], format: 'keep' } }];
    default:
      return [];
  }
}

async function post(email: string, at: string, id: string, args: unknown[]) {
  const r = await fetch(`${DASH}${at}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Next-Action': id,
      'Content-Type': 'text/plain;charset=UTF-8',
      Accept: 'text/x-component',
      Cookie: `kgc_console_session=${await cookieFor(email)}`,
    },
    body: JSON.stringify(args),
  });
  return { status: r.status, body: await r.text(), location: r.headers.get('location') ?? r.headers.get('x-action-redirect') ?? '' };
}

async function snapshot() {
  return JSON.stringify({
    doc: await fsGet('pageLayouts/learn'),
    versions: await fsList('pageLayouts/learn/versions'),
    library: await fsList('pageLayouts/learn/library'),
    media: await fsList('pageLayouts/learn/media'),
    audit: (await fsList('auditLog')).length,
    files: await storageList(),
  });
}

test('an agenda-only member is refused by every Learn page action, and nothing changes', async () => {
  for (const sub of ['versions', 'library', 'media']) for (const d of await fsList(`pageLayouts/learn/${sub}`)) await fsDelete(`pageLayouts/learn/${sub}/${d.id}`);
  await storageClear();
  const now = Date.now();
  await fsSet('pageLayouts/learn', {
    draft: page(CANARY),
    published: page(CANARY),
    revision: 3,
    draftUpdatedAt: now,
    draftUpdatedBy: OWNER,
    publishedAt: now,
    publishedBy: OWNER,
    previewToken: 'A'.repeat(43),
    scheduledPublishAt: now + 3600e3,
    scheduledBy: OWNER,
    scheduledRevision: 3,
  });
  await fsSet('pageLayouts/learn/versions/v-gate', { content: page(CANARY), publishedAt: now, publishedBy: OWNER });
  await fsSet('pageLayouts/learn/library/l-gate', { name: CANARY, section: section(CANARY), createdAt: now, createdBy: OWNER });
  await fsSet('pageLayouts/learn/media/m-gate', {
    image: { src: '/kgc/wave-3.png', alt: CANARY, width: 10, height: 10 },
    fileName: CANARY,
    bytes: 10,
    uploadedAt: now,
    uploadedBy: OWNER,
  });

  const actions = learnActions();
  expect([...actions.keys()].sort()).toHaveLength(21);

  // The control: the same request shape from a learn-only member runs the action.
  const control = await post(LEARN, '/content/learn-page', actions.get('listLearnLibraryAction')!, []);
  expect(control.body).toContain(CANARY);

  const before = await snapshot();
  const home = (await fetch(`${DASH}/`, { redirect: 'manual', headers: { Cookie: `kgc_console_session=${await cookieFor(AGENDA)}` } })).headers.get(
    'location',
  );
  expect(home).toBeTruthy();
  const homePath = new URL(home!, DASH).pathname;
  expect(homePath).not.toContain('learn');

  const rows: string[] = [];
  for (const [name, id] of actions) {
    for (const at of ['/content/learn-page', homePath]) {
      const res = await post(AGENDA, at, id, argsFor(name, 3));
      rows.push(`${name} at ${at}: ${res.status} ${res.location}`);
      expect(res.body, `${name} at ${at}`).not.toContain(CANARY);
      expect(res.body, `${name} at ${at}`).not.toMatch(/"ok":true/);
    }
  }
  console.log(rows.join('\n'));
  expect(await snapshot()).toBe(before);
});
