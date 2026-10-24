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

// Watching the workspace root also lets Metro bundle anything under it, and
// expo-go-share.sh puts this Metro on a public link (T240: any repo .js or
// .json file, `.secrets/` included, could be fetched as a bundle). The app
// bundles only app/, packages/ and node_modules/, so keep the rest out of
// Metro's file map: secrets, env files, the websites, the Cloud Functions,
// the Node scripts and the tests. A file that is not in the map cannot be
// resolved, bundled or served as an asset, whatever the URL asks for.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const root = escape(workspaceRoot + path.sep);
const app = escape(projectRoot + path.sep);
const notBundled = [
  new RegExp(`^${root}\\.secrets(/.*)?$`),
  /(^|\/)\.env(\.[^/]*)?$/,
  new RegExp(`^${root}(apps|functions|scripts|tests|demo|docs)(/.*)?$`),
  new RegExp(`^${app}(scripts|preview-out|expo-go-out)(/.*)?$`),
];
const defaultBlockList = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(defaultBlockList) ? defaultBlockList : defaultBlockList ? [defaultBlockList] : []),
  ...notBundled,
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
