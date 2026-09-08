/**
 * Where this feature lives, in one place.
 *
 * ⚠️ A plain module and **not** part of `actions.ts`, which carries
 * `'use server'`. A `'use server'` file may export nothing but async functions —
 * every export becomes a callable endpoint — so a `const` beside the actions is
 * a hard build error reading *"Only async functions are allowed to be exported
 * in a 'use server' file"*, and neither `tsc` nor `eslint` catches it. It only
 * shows up when Next compiles the route, which is a long way from where the line
 * was written.
 */
export const CFA_BASE = '/content/call-for-speakers-abstracts';
