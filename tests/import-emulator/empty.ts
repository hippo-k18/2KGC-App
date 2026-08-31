/**
 * A stand-in for the `server-only` package.
 *
 * `server-only` throws on import outside a React Server Component, which is
 * what makes it useful in the dashboard and what makes `import.ts` — the half
 * that actually writes to Firestore — unloadable by Vitest. Aliasing it to
 * nothing lets this suite exercise the real writer against the emulator rather
 * than a re-implementation of it, which is the only version of this test worth
 * having: a copy of the write path could agree with itself and disagree with
 * production.
 */
export {};
