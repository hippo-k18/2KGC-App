/**
 * A stand-in for `next/cache` outside a Next request.
 *
 * `revalidateTag` throws when there is no Next request around it. `vi.mock`
 * cannot replace it here, because `apps/web` resolves `next` from its own
 * `node_modules` and the test file resolves it from the root, so the config
 * aliases the module instead.
 */
export const revalidateTag = (_tag: string) => {};
