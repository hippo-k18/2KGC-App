import 'server-only';

import type { LearnPageContent, LearnPageDoc } from '@kgc/shared';
import { db } from './firestore';
import { learnPageDevDefault } from './learn-page-dev-default';

/**
 * ⚠️ A stand-in for T309's `@/lib/learn-page` (`loadLearnEditor` and its
 * types), with the same names and shapes as `orchestrator/reports/T309-api.md`.
 * It exists so the editor (T310) could be built while the store was being
 * written. On merge, delete this file and `learn-page-dev-default.ts`, and
 * point the two imports in `content/learn-page/` at `@/lib/learn-page`.
 */

export interface LearnVersionSummary {
  id: string;
  publishedAt: number;
  publishedBy: string;
  note?: string;
}

export interface LearnEditorState {
  doc: LearnPageDoc;
  exists: boolean;
  versions: LearnVersionSummary[];
  hasUnpublishedChanges: boolean;
}

export const DEV_DOC = 'pageLayouts/learn';

export async function loadLearnEditor(): Promise<LearnEditorState> {
  const ref = db().doc(DEV_DOC);
  const snap = await ref.get();
  const versions = await ref.collection('versions').orderBy('publishedAt', 'desc').limit(50).get();
  const doc: LearnPageDoc = snap.exists
    ? (snap.data() as LearnPageDoc)
    : {
        draft: learnPageDevDefault(),
        published: null,
        draftUpdatedAt: 0,
        draftUpdatedBy: '',
        revision: 0,
      };
  return {
    doc,
    exists: snap.exists,
    versions: versions.docs.map((d) => ({
      id: d.id,
      publishedAt: d.get('publishedAt') as number,
      publishedBy: d.get('publishedBy') as string,
      note: d.get('note') as string | undefined,
    })),
    hasUnpublishedChanges:
      snap.exists && JSON.stringify(doc.draft) !== JSON.stringify(doc.published),
  };
}

export async function loadLearnVersion(id: string): Promise<LearnPageContent | null> {
  const snap = await db().doc(DEV_DOC).collection('versions').doc(id).get();
  return snap.exists ? (snap.get('content') as LearnPageContent) : null;
}
