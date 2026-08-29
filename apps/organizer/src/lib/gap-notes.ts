/**
 * Whether the dashboard shows its own gap notes.
 *
 * 126 screens carry a "Not built here" panel, and eight carry a full gap card.
 * They are honest and they are useful — each one measures what this repo does
 * not do against live data — but they are written for whoever is building this,
 * not for the room the dashboard is being demonstrated to. An audience reads
 * "Not built here" on nearly every screen as a verdict on the whole product.
 *
 * So they are off by default and turned on deliberately:
 *
 *     SHOW_GAP_NOTES=1 npm run dev
 *
 * Off is the safer default because the failure modes are asymmetric. A gap note
 * that fails to appear during development costs a look at `ROADMAP.md`; one that
 * appears during a demo costs the demo.
 *
 * Not `server-only`, and not `NEXT_PUBLIC_`: every screen that renders a gap
 * note is a server component, so this is read on the server and the flag never
 * reaches a browser bundle. If a client component ever needs it, pass it as a
 * prop rather than republishing the value.
 */
export function gapNotesVisible(): boolean {
  return process.env.SHOW_GAP_NOTES === '1';
}
