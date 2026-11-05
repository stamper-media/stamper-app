// jest-expo resolves modules the way Metro does for react-native; jest.resolver.js adds the
// `import`/`browser` fallbacks Metro applies (see metro.config.js). Many dependencies of the
// pure packages are ESM-only, so everything in node_modules is transformed except Babel's
// own runtime helpers and a few large CommonJS packages.
const skip = [
  "@babel\\+runtime",
  "@babel\\+core",
  "react@",
  "react-is@",
  "scheduler@",
  "jest-",
  "@jest\\+",
  "typescript@",
];

module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/__tests__/**/*.test.ts?(x)"],
  resolver: "<rootDir>/jest.resolver.js",
  transformIgnorePatterns: [`/node_modules/\\.pnpm/(${skip.join("|")})`],
  setupFiles: ["<rootDir>/jest.setup.js"],
  testTimeout: 60_000,
};
