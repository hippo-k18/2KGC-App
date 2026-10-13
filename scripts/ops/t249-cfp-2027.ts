/**
 * T249: move the live KGC 2027 call onto Min's rolling review.
 *
 *   npx tsx scripts/ops/t249-cfp-2027.ts                 # dry run: prints the plan, writes nothing
 *   npx tsx scripts/ops/t249-cfp-2027.ts --apply         # backs up, then writes
 *     [--backup-dir=<dir>] [--call=call-for-speakers-kgc-2027]
 *     [--accept-notice=<email>] [--reminder=<email>]
 *
 * Without FIRESTORE_EMULATOR_HOST this is the LIVE project, through
 * GOOGLE_APPLICATION_CREDENTIALS. Run it from the repo root.
 *
 * What it changes on `calls/{id}`, and nothing else:
 *
 * 1. `instructions` becomes Min's section 2 page copy. "[CLOSE DATE]" and
 *    "[DECISION DATE]" stay in it as tokens: the website fills them from the
 *    settings and leaves the sentence out while a date is unset.
 * 2. The form: Min's stopgap ("workshops only" notes, optional workshop
 *    questions, a "talks only" length question) becomes per-type questions.
 *    The three workshop questions are asked of workshops only and required of
 *    them; "Have you run this workshop before?" is workshops only and
 *    optional; the talk length question and the two notes are removed,
 *    because the form now changes with the type and a talk's length is its
 *    own field. Removing questions is a breaking change, so the old form is
 *    archived in `priorVersions` and the version goes up, exactly as the
 *    dashboard's form builder does it. Answers already given are kept.
 * 3. `cfp` is created with the default word limits and talk lengths, and the
 *    two addresses if given. The dates are left unset (decided at the Friday
 *    weekly), and the dashboard warns until they are filled in.
 *
 * The backup is the whole call document as JSON, written before any write.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Timestamp } from 'firebase-admin/firestore';
import { COLLECTIONS, type CallDoc, type CallFormFieldDef } from '@kgc/shared';
import { db, targetDescription } from '../src/lib/firestore.js';
import { planFormVersion } from '../src/lib/question-forms.js';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'] as const;
  }),
);
const APPLY = args.get('apply') === 'true';
const CALL_ID = args.get('call') ?? 'call-for-speakers-kgc-2027';
const BACKUP_DIR = args.get('backup-dir') ?? path.resolve('..', 'backups', 't249');

/** Min's plan, section 2, with the line wrapping of the Google Doc taken out. */
export const PAGE_COPY = [
  'We want talks and workshops about real work: something you built, a decision you would change, a project that went wrong, results you measured. No product pitches.',
  'Formats. Conference talks run 25 or 45 minutes, Wednesday 5 to Friday 7 May 2027. Hands-on workshops run Monday 3 and Tuesday 4 May 2027, at Jay Conference Bryant Park, New York. Choose "talk" or "workshop" below. If you want to offer both, submit twice.',
  'What we ask for now. Your name, email and organisation, a title, an abstract of roughly 150 to 300 words, the session type and a track. Workshops also need learning objectives, an outline, and anything attendees have to install. Bio and photo come later, after acceptance.',
  'How we review. We read submissions every week and accept as we go, rather than holding everything until a deadline. If your session is a fit you hear early, and we start promoting you early.',
  'Three things worth knowing before you submit:',
  '- Submitting early genuinely helps. Slots are limited and they fill as we go, so the earlier you are in, the more room there is. It is not first come first served, and we will not take a weak session because it arrived early. But it is not neutral either.',
  '- Not hearing from us is not a no. A submission we have not answered is still open and still being read. Every submission gets a decision, yes or no, by [DECISION DATE] at the latest.',
  '- You can ask us at any time. If you want to know where your submission stands, write to contact@knowledgegraph.tech and we will tell you plainly.',
  'If we accept you, we will email you for the rest: bio, headshot, final title and session details. You have one week to send them, after which the slot may go to someone else.',
  'Submissions close [CLOSE DATE].',
].join('\n\n');

const WORKSHOP_REQUIRED = [
  'workshop-learning-objectives',
  'workshop-outline',
  'what-attendees-need-to-bring-or-install',
];
const WORKSHOP_OPTIONAL = ['have-you-run-this-workshop-before'];
const REMOVE = [
  'everyone-the-title-abstract-session-type',
  'preferred-talk-length-talks-only',
  'workshop-proposals-only-please-answer-th',
];

export function planForm(form: CallFormFieldDef[]): { after: CallFormFieldDef[]; notes: string[] } {
  const notes: string[] = [];
  const after = form
    .filter((f) => {
      if (REMOVE.includes(f.id)) {
        notes.push(`remove “${f.prompt.slice(0, 60)}”`);
        return false;
      }
      return true;
    })
    .map((f) => {
      if (WORKSHOP_REQUIRED.includes(f.id)) {
        notes.push(`workshops only, required: “${f.prompt}”`);
        return { ...f, sessionTypes: ['workshop' as const], required: true };
      }
      if (WORKSHOP_OPTIONAL.includes(f.id)) {
        notes.push(`workshops only, optional: “${f.prompt}”`);
        return { ...f, sessionTypes: ['workshop' as const] };
      }
      return f;
    })
    .map((f, i) => ({ ...f, order: i * 10 }));
  for (const id of [...WORKSHOP_REQUIRED, ...WORKSHOP_OPTIONAL, ...REMOVE]) {
    if (!form.some((f) => f.id === id)) notes.push(`⚠️ expected question “${id}” is not on the form; left alone`);
  }
  return { after, notes };
}

async function main() {
  const ref = db().collection(COLLECTIONS.calls).doc(CALL_ID);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`No call ${CALL_ID} on ${targetDescription()}`);
  const call = snap.data() as CallDoc;

  const before = [...(call.form ?? [])].sort((a, b) => a.order - b.order);
  const { after, notes } = planForm(before);
  const plan = planFormVersion(before, after, call.formVersion ?? 1);

  const cfp = {
    ...(call.cfp ?? {}),
    abstractMinWords: call.cfp?.abstractMinWords ?? 150,
    abstractMaxWords: call.cfp?.abstractMaxWords ?? 300,
    talkMinutes: call.cfp?.talkMinutes ?? [25, 45],
    ...(args.get('accept-notice') ? { acceptNoticeEmail: args.get('accept-notice')!.toLowerCase() } : {}),
    ...(args.get('reminder') ? { reviewerReminderEmail: args.get('reminder')!.toLowerCase() } : {}),
  };

  console.log(`Target: ${targetDescription()}, calls/${CALL_ID}`);
  console.log(`Description: ${call.instructions === PAGE_COPY ? 'already Min’s section 2' : 'replace with Min’s section 2'}`);
  console.log(`Form: v${call.formVersion ?? 1} → v${plan.version}`);
  for (const n of notes) console.log(`  ${n}`);
  console.log(`cfp: ${JSON.stringify(cfp)}`);

  if (!APPLY) {
    console.log('\nDry run. Nothing written. Add --apply to write.');
    return;
  }

  mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `call-${CALL_ID}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(
    file,
    JSON.stringify(call, (_k, v) => (v instanceof Timestamp ? { _ts: v.toDate().toISOString() } : v), 2),
  );
  console.log(`Backup: ${file}`);

  const priorVersions = [...(call.priorVersions ?? [])];
  if (plan.bumped) {
    priorVersions.push({ version: call.formVersion ?? 1, fields: before, supersededAt: Timestamp.now() });
  }
  await ref.update({
    instructions: PAGE_COPY,
    form: after,
    formVersion: plan.version,
    priorVersions,
    cfp,
    updatedBy: 't249-migration',
    updatedAt: Timestamp.now(),
  });
  console.log('Written.');
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
