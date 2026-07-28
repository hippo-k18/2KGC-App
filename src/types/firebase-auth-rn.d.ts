/**
 * `getReactNativePersistence` is missing from the `firebase/auth` type
 * definitions, but not from the code.
 *
 * The umbrella `firebase/auth` module is a one-line `export * from
 * '@firebase/auth'`, and Metro resolves `@firebase/auth` through its
 * `react-native` field to a build that does export the function. TypeScript,
 * however, follows the umbrella package's `types` field to a browser-only
 * declaration file that omits it — so the import fails to compile even though
 * it works at runtime.
 *
 * Declaring it here is preferable to adding `@firebase/auth` as a direct
 * dependency: a second copy resolving at a different version would give the app
 * two separate auth instances, which fails in confusing ways.
 *
 * Revisit when firebase-js-sdk fixes its export map (as of firebase 12.16.0 /
 * @firebase/auth 1.13.3 it has not).
 */
// This import is load-bearing: it makes this file a module, so the block below
// *augments* firebase/auth. Without it the file is global and the declaration
// would replace the module's types entirely.
import 'firebase/auth';

declare module 'firebase/auth' {
  /** The subset of AsyncStorage that Firebase actually calls. */
  export interface ReactNativeAsyncStorage {
    setItem(key: string, value: string): Promise<void>;
    getItem(key: string): Promise<string | null>;
    removeItem(key: string): Promise<void>;
  }

  export function getReactNativePersistence(
    storage: ReactNativeAsyncStorage,
  ): Persistence;
}
