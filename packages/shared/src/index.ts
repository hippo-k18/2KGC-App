/**
 * Everything Cloud Functions, the scripts and the app all need: document shapes
 * and collection-name constants. Plain TS only — no React, no Firebase client or
 * Admin SDK — so it can be imported from any of them without pulling in
 * dependencies that belong to just one. See the `Timestamp` comment in
 * `models.ts` for why that extends to the Firestore SDK too.
 *
 * The `.js` specifiers are deliberate and are not a mistake: this package is
 * `"type": "module"`, so Node resolves these at runtime under ESM rules, where
 * extensionless relative imports are an error. TypeScript and Metro both map
 * them back to the `.ts` sources. Dropping the extension makes the app build
 * fine and the Node-based scripts fail with "does not provide an export named".
 */
export * from "./models.js";
export * from "./collections.js";
export * from "./event.js";
export * from "./settings.js";
export * from "./page-content.js";
