/**
 * Week-1 spike (plan WP-10): does @filoz/synapse-core/piece bundle under Metro/Hermes, how big is
 * the bundle, and is @filoz/synapse-sdk kept out? Runs `expo export --platform android` with
 * source maps and inspects the module list. Hash timing needs a device and is not measured here.
 *
 *   node scripts/spike-piece-hermes.ts [outDir]     (Node >= 22.18 strips the types)
 *   Wrap with `flock <repo>/.heavy.flock` on shared hosts.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = process.argv[2] ?? mkdtempSync(join(tmpdir(), "stamper-hermes-"));
const started = Date.now();
execFileSync(
  "npx",
  ["expo", "export", "--platform", "android", "--source-maps", "--output-dir", out],
  {
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1" },
  },
);
const dir = join(out, "_expo/static/js/android");
const files = readdirSync(dir);
const hbc = files.find((f) => f.endsWith(".hbc"));
const map = files.find((f) => f.endsWith(".map"));
if (!hbc || !map) throw new Error(`bundle or source map missing in ${dir}`);
const sources: string[] = JSON.parse(readFileSync(join(dir, map), "utf8")).sources ?? [];
const has = (re: RegExp) => sources.filter((s) => re.test(s));
const report = {
  bundle: hbc,
  bytes: statSync(join(dir, hbc)).size,
  modules: sources.length,
  synapseCorePiece: has(/@filoz\/synapse-core\/dist\/src\/piece\//).length,
  synapseCoreTotal: has(/@filoz\/synapse-core\//).length,
  syncMultihashSha256: has(/sync-multihash-sha2\/src\/sha256\//).map((s) =>
    s.replace(/^.*sync-multihash-sha2\//, ""),
  ),
  synapseSdk: has(/@filoz\/synapse-sdk\//).length,
  stamperCore: has(/packages\/core\/dist\//).length,
  stamperMinimise: has(/packages\/minimise\/dist\//).length,
  exportSeconds: Math.round((Date.now() - started) / 1000),
};
console.log(JSON.stringify(report, null, 2));
if (report.synapseSdk > 0) {
  console.error("FAIL: @filoz/synapse-sdk is in the bundle");
  process.exit(1);
}
if (report.synapseCorePiece === 0) {
  console.error("FAIL: @filoz/synapse-core/piece did not bundle");
  process.exit(1);
}
