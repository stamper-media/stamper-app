// Metro resolves package "exports" with `require`, `import` and `react-native` conditions
// (unstable_enablePackageExports). ESM-only packages such as multiformats 14 expose only
// `import`, and sync-multihash-sha2/sha256 only `browser`/`node`; metro.config.js adds `browser`
// for that package, so fall back to those conditions when the CommonJS ones find nothing.
module.exports = (request, options) => {
  try {
    return options.defaultResolver(request, options);
  } catch (e) {
    const conditions = [...(options.conditions ?? ["require", "default"]), "import", "browser"];
    try {
      return options.defaultResolver(request, { ...options, conditions });
    } catch {
      throw e;
    }
  }
};
