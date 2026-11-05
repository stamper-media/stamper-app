// Metro for a pnpm workspace: watch the repo root, resolve through the symlinked
// node_modules, and honour package "exports" (needed for @filoz/synapse-core/piece).
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;

// The app never ships the full Synapse SDK (WP-10 acceptance): fail the bundle if anything pulls it.
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@filoz/synapse-sdk" || moduleName.startsWith("@filoz/synapse-sdk/")) {
    throw new Error(
      `@filoz/synapse-sdk must not be bundled (requested by ${context.originModulePath})`,
    );
  }
  // sync-multihash-sha2/sha256 (used by @filoz/synapse-core/piece) exports only `browser` and
  // `node`; the browser build is pure @noble/hashes and is the right one for Hermes.
  if (moduleName.startsWith("sync-multihash-sha2/")) {
    const names = context.unstable_conditionNames ?? ["require", "import"];
    context = { ...context, unstable_conditionNames: [...names, "browser"] };
  }
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
