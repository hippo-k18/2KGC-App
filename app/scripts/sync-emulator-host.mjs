#!/usr/bin/env node
/**
 * Point `EXPO_PUBLIC_EMULATOR_HOST` at whatever this Mac's LAN address is today.
 *
 * A phone cannot reach `localhost` — that word means the phone — so running
 * against the Firebase emulators from a real device needs the Mac's LAN IP
 * written into `app/.env.local`. That address is assigned by whichever network
 * the Mac is on, so it changes when the machine moves, and nothing about the
 * failure says so: the Firestore SDK does not report an unreachable host, it
 * waits out its own ten-second `OnlineStateTracker` timeout and then serves the
 * empty local cache. The app comes up blank, or shows confident empty states.
 *
 * That has now cost real time twice on this project — once as a "10–20 second
 * blank wait" on session detail, and once as an app that rendered nothing at all
 * while both the emulators and Metro were up and healthy. It is a one-line
 * mismatch that presents as a hard bug, so it is worth a script rather than a
 * paragraph in a README.
 *
 * Runs before `expo start` and rewrites the line only when it is wrong, so it
 * stays quiet on the common path. It deliberately touches nothing else in the
 * file, and does nothing at all if `.env.local` is absent or has no such key —
 * this is a convenience for local device testing, not a config generator.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_PATH = join(dirname(dirname(fileURLToPath(import.meta.url))), '.env.local');
const KEY = 'EXPO_PUBLIC_EMULATOR_HOST';

/** First non-internal IPv4 address — the one a phone on the same wifi can reach. */
function lanAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return null;
}

if (!existsSync(ENV_PATH)) process.exit(0);

const contents = readFileSync(ENV_PATH, 'utf8');
const current = contents.match(new RegExp(`^${KEY}=(.*)$`, 'm'))?.[1]?.trim();
if (current === undefined) process.exit(0);

// `localhost` is a deliberate choice for simulator-only work, not a stale value.
if (current === 'localhost' || current === '127.0.0.1') process.exit(0);

const ip = lanAddress();
if (!ip || ip === current) process.exit(0);

writeFileSync(ENV_PATH, contents.replace(new RegExp(`^${KEY}=.*$`, 'm'), `${KEY}=${ip}`));
console.log(
  `[sync-emulator-host] ${KEY}: ${current} -> ${ip}\n` +
    '  This Mac has moved network since the last run. Restart with `expo start -c` if\n' +
    '  Metro was already running — EXPO_PUBLIC_* values are inlined at bundle time.',
);
