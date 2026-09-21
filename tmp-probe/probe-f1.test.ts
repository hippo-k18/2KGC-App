/**
 * Throwaway adversarial probe. Not part of the suite. Deleted after the run.
 *
 * Finding 1: is an unfiltered getDocs on communityPosts/{p}/replies as a
 * non-author, non-organizer attendee still able to pull back a hidden reply?
 * Plus every way round it I can think of.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  collectionGroup,
  doc,
  getDocs,
  getDoc,
  limit,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const A = 'attendeeA';
const B = 'attendeeB';
const ORG = 'organizerU';
const PROJECT_ID = `kgc-probe-f1-${process.pid}`;

let env: RulesTestEnvironment;

const attendee = (uid: string) => ({
  registered: true,
  roles: ['attendee'],
  email: `${uid}@kgc.test`,
  email_verified: true,
});
const organizer = { registered: true, roles: ['organizer'], email: `${ORG}@kgc.test`, email_verified: true };

const asA = () => env.authenticatedContext(A, attendee(A)).firestore();
const asB = () => env.authenticatedContext(B, attendee(B)).firestore();
const asOrg = () => env.authenticatedContext(ORG, organizer).firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});

afterAll(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'settings/appAccess'), {
      closesAtMs: 0, readOnlyFromMs: 0, messagingEnabled: true, joinCodeRequired: false,
    });
    await setDoc(doc(db, 'communityPosts/p1'), {
      eventId: 'kgc-2027', authorId: A, title: 'Post', body: 'b', replyCount: 0, reactionCount: 0,
    });
    // visible, hidden (authored by A), and one written before `status` existed
    await setDoc(doc(db, 'communityPosts/p1/replies/rOk'), {
      eventId: 'kgc-2027', authorId: A, body: 'fine', status: 'visible', createdAt: new Date(1),
    });
    await setDoc(doc(db, 'communityPosts/p1/replies/rHidden'), {
      eventId: 'kgc-2027', authorId: A, body: 'DOXXING TEXT', status: 'hidden', createdAt: new Date(2),
    });
    await setDoc(doc(db, 'communityPosts/p1/replies/rLegacy'), {
      eventId: 'kgc-2027', authorId: A, body: 'pre-status', createdAt: new Date(3),
    });
  });
});

const ids = (snap: any) => snap.docs.map((d: any) => d.id).sort().join(',');

describe('finding 1 probe: hidden replies on an unfiltered query', () => {
  it('THE FINDING: unfiltered getDocs as non-author attendee B', async () => {
    const q = collection(asB(), 'communityPosts/p1/replies');
    try {
      const snap = await getDocs(q);
      console.log('UNFILTERED RETURNED:', ids(snap));
      throw new Error(`UNFILTERED LIST ALLOWED, returned: ${ids(snap)}`);
    } catch (e: any) {
      console.log('UNFILTERED DENIED:', e.code ?? e.message);
      expect(String(e.code ?? e.message)).toContain('permission-denied');
    }
  });

  it('the filtered query the app sends still works and omits the hidden one', async () => {
    const snap = await assertSucceeds(
      getDocs(query(collection(asB(), 'communityPosts/p1/replies'), where('status', '==', 'visible'))),
    );
    console.log('FILTERED RETURNED:', ids(snap));
    expect(ids(snap)).toBe('rOk');
  });

  // --- adversarial: ways round the filter ---

  it('cannot ask for status == hidden', async () => {
    await assertFails(
      getDocs(query(collection(asB(), 'communityPosts/p1/replies'), where('status', '==', 'hidden'))),
    );
  });

  it('cannot use an inequality that admits hidden', async () => {
    await assertFails(
      getDocs(query(collection(asB(), 'communityPosts/p1/replies'), where('status', '>=', 'a'))),
    );
  });

  it('cannot use `in` to widen', async () => {
    await assertFails(
      getDocs(query(collection(asB(), 'communityPosts/p1/replies'), where('status', 'in', ['visible', 'hidden']))),
    );
  });

  it('cannot use != visible', async () => {
    await assertFails(
      getDocs(query(collection(asB(), 'communityPosts/p1/replies'), where('status', '!=', 'visible'))),
    );
  });

  it('cannot reach it through a collectionGroup unfiltered', async () => {
    await assertFails(getDocs(collectionGroup(asB(), 'replies')));
  });

  it('cannot reach it through a collectionGroup filtered to hidden', async () => {
    await assertFails(
      getDocs(query(collectionGroup(asB(), 'replies'), where('status', '==', 'hidden'))),
    );
  });

  it('a collectionGroup filtered to visible is fine and omits it', async () => {
    const snap = await assertSucceeds(
      getDocs(query(collectionGroup(asB(), 'replies'), where('status', '==', 'visible'))),
    );
    console.log('CG FILTERED:', ids(snap));
    expect(ids(snap)).toBe('rOk');
  });

  it('THE GAP TO LOOK FOR: a direct get of the hidden reply by a non-author', async () => {
    try {
      const snap = await getDoc(doc(asB(), 'communityPosts/p1/replies/rHidden'));
      console.log('DIRECT GET ALLOWED, body =', snap.data()?.body);
      throw new Error('DIRECT GET OF HIDDEN REPLY ALLOWED');
    } catch (e: any) {
      console.log('DIRECT GET DENIED:', e.code ?? e.message);
      expect(String(e.code ?? e.message)).toContain('permission-denied');
    }
  });

  it('the author still reaches their own hidden reply by get', async () => {
    await assertSucceeds(getDoc(doc(asA(), 'communityPosts/p1/replies/rHidden')));
  });

  it('an organizer still reaches an unfiltered list', async () => {
    const snap = await assertSucceeds(getDocs(collection(asOrg(), 'communityPosts/p1/replies')));
    console.log('ORGANIZER UNFILTERED:', ids(snap));
    expect(ids(snap)).toBe('rHidden,rLegacy,rOk');
  });

  it('REGRESSION RISK: a pre-status reply is still readable by get to a non-author', async () => {
    const snap = await assertSucceeds(getDoc(doc(asB(), 'communityPosts/p1/replies/rLegacy')));
    console.log('LEGACY GET OK, body =', snap.data()?.body);
  });

  it('REGRESSION RISK: is a pre-status reply reachable by the app query at all?', async () => {
    const snap = await assertSucceeds(
      getDocs(query(collection(asB(), 'communityPosts/p1/replies'), where('status', '==', 'visible'))),
    );
    console.log('APP QUERY SEES:', ids(snap), '-- rLegacy invisible to the app:', !ids(snap).includes('rLegacy'));
  });

  it('an author cannot create a reply already hidden', async () => {
    await assertFails(
      setDoc(doc(asB(), 'communityPosts/p1/replies/new1'), {
        eventId: 'kgc-2027', authorId: B, body: 'x', status: 'hidden',
      }),
    );
  });

  it('an author cannot un-hide their own hidden reply', async () => {
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(asA(), 'communityPosts/p1/replies/rHidden'), { status: 'visible', editedAt: new Date() }),
    );
  });
});
