# Spike: `@filoz/synapse-core/piece` under Metro / Hermes (WP-10, 2026-10-01)

Plan target: `docs/spikes/hermes-piece.md`. WP-10 owns only `apps/mobile/**`, so the record lives
here; copy or link it from `docs/spikes/` when merging.

## Setup
- Expo SDK 57 (`expo@57.0.26`, `react-native@0.86.3`, Hermes), pnpm isolated workspace, Node 22.20.
- `metro.config.js`: `unstable_enablePackageExports: true`, symlinks on, workspace root watched.
- Command: `node scripts/spike-piece-hermes.ts <outDir>` (runs `expo export --platform android
  --source-maps` and inspects the module list).

## Results
| Question | Result |
|---|---|
| Does `@filoz/synapse-core/piece` bundle? | **Yes**: 17 modules from `synapse-core/dist/src/piece/`, 45 from synapse-core in total |
| Resolver change needed? | **Yes**: `sync-multihash-sha2/sha256` exports only the `browser` and `node` conditions, and Metro's native condition set has neither. `metro.config.js` adds `browser` for that package only. The browser build is pure `@noble/hashes`. |
| `@filoz/synapse-sdk` in the bundle? | **No** (0 modules). `metro.config.js` also makes the bundle fail if anything requests it |
| Android Hermes bundle size | 7,984,016 B (`expo export`, no source maps) / 6,467,088 B (`--source-maps` run); 3,057 modules |
| Export wall time on this host | 27–44 s |
| Time to hash 4 MiB on device, per implementation | **Not measured**: there is no device or emulator run on this host (no native build was attempted). |
| Reference timing (Node/jest, not Hermes) | 1 MiB: synapse ≈ 0.9–1.3 s, fr32 ≈ 0.4–0.6 s (both under the babel-transformed jest runtime, so not representative) |

## Decision
- The app keeps `PIECE_IMPL = 'fr32'` (`lib/hash.ts`), the pure-JS tree in `@stamper/core`. Both
  implementations produce the same PieceCID (`__tests__/claim.test.ts`, `hermes-smoke.test.ts`).
- Switch to `'synapse'` only after a development build measures 4 MiB on a mid-range Android and an
  iPhone. Measure with the `hashPhoto` timing in a dev build, then record the numbers here.
