const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// This app now lives inside an npm workspace (2KGC-App/app). `@kgc/shared`
// is hoisted to the workspace root's node_modules as a symlink, and Metro
// — unlike Node — does not walk up the tree to find it, and by default only
// watches this directory. Both need to be told about the workspace root
// explicitly, or `@kgc/shared` resolves fine for `tsc` but fails to bundle.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// `packages/shared` is `"type": "module"` so the Node-based scripts in
// `scripts/` can import it, and Node's ESM resolver requires a file extension
// on relative imports — hence its `index.ts` re-exporting `./models.js`.
//
// Metro does not apply TypeScript's `.js` → `.ts` mapping, so without this it
// looks for a literal `models.js` that does not exist, and the bundle fails
// while `tsc` stays perfectly green. Strip the extension for that package only
// and let Metro's normal `sourceExts` resolution find the `.ts` file.
const sharedRoot = path.resolve(workspaceRoot, 'packages/shared');
const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  if (
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js') &&
    context.originModulePath?.startsWith(sharedRoot)
  ) {
    return resolve(context, moduleName.slice(0, -3), platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
