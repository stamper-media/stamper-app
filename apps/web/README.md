# @stamper/web — verify site

Next.js 16.3.8 (App Router, React 19.2) site for Stamper (plan WP-09). Every verdict input comes from
`eth_call` against two RPCs, compared, plus this browser's own re-hash. The api adds presentation only.

## Routes
| Route | What it does |
|---|---|
| `/` | code input (normalised by `@stamper/core`), link to the scanner, "check a copy" drop zone |
| `/v/[code]` | verify page: Header, Compare, Record, Chain, Storage, Evidence, plus the 11 failure screens from DESIGN §8.2 (`lib/copy.ts` `FAILURES`) |
| `/v/[code]/c/[cid]` | forensic QR path; redirects to `/v/[code]` |
| `/s/[code]` | share page; OG/Twitter image is `${API}/v1/stamps/{code}/share-card.png` |
| `/scan` | camera or picture QR decoding (barcode-detector ponyfill; the wasm is served from `/zxing_reader.wasm`) |
| `/status` | storage health from `/v1/health/storage` |
| `/about` | what a stamp proves and what it does not (DESIGN §1.1–1.2, reworded to avoid the banned words) |

## Modules
- `lib/chain.ts`: `lookupByCode(code9, reader?)`, `loadStamp(stampId, reader?)`, `chainVerifyIO(reader?, typedCode?)`, `agree()`. Reads go through the `@stamper/contracts-abi` helpers. Multicall3 is used on Filecoin chains.
- `lib/reverify.ts`: `reverifyDeviceSignature(bundle, stampId, chainId, registry)`, `reverifyCountersignature(bundle, chainId, registry, stampId, countersig?)`.
- `lib/fetch-original.ts`: `fetchOriginal(sources, expect, onProgress, opts)` and `buildSources()`. Sources are raced with HEAD and taken in the order FilBeam → providers → mirror; a 402 is skipped.
- `lib/hashing.ts`: streaming hash-wasm SHA-256 plus synapse-core `transformStream`. `workers/hash.worker.ts` runs it in the browser.
- `lib/compare.ts` and `lib/diff.ts`: pixelmatch plus ssim.js in `workers/diff.worker.ts`.
- `lib/verdict.ts`: core `decide()`, view mapping, notices and tier input.
- `lib/api.ts`: zod-typed WP-07 client.
- `lib/copy.ts`: every user-facing string. Tier sentences and the footer come from core.

## Env (all `NEXT_PUBLIC_*`, inlined at build time)
`CHAIN_ID` (31337 | 314159 | 314), `RPC_URLS` (comma-separated, ≥ 2 in prod), `REGISTRY_ADDRESS` and
`RESOLVER_ADDRESS` (default: `deploymentFor(chainId)`), `API_URL`, `ORIGIN` (the single public-origin
constant; default core `DEFAULT_ORIGIN`), `VERIFY_BASE_URL`, `FILBEAM_PAYER` (gives
`https://{payer}.filbeam.io`, or `calibration.filbeam.io` on 314159), `FILBEAM_BASE` (test override),
`MIRROR_URL`, `EXPLORERS` (`blockscout=…,filfox=…,pdp=…`, overriding per key the public defaults for 314 and 314159; none on 31337. Each binding links to `{pdp}/dataset/{dataSetId}`, e.g. `https://pdp.filecoin.cloud/calibration/dataset/40026`), `WEB_CAPTURE=0`.

## Tests
- `pnpm --filter @stamper/web typecheck`
- `pnpm --filter @stamper/web test`: vitest unit tests (chain decoding against ABI-encoded fixtures, reverify with the core claim vectors, fetch order and the 402 skip, verdict mapping, failure screens, banned words over the copy and the rendered panels, finality, UTC formatting, config, hashing, diff).
- `apps/web/scripts/e2e.sh`: picks free ports, then runs `next build` + `next start` against `tests/fixtures/server.ts` (two mock RPCs, a FilBeam 402, provider, mirror and the presentation api) under the heavy lock. Needs `playwright install chromium`. To run against the WP-12 stack, set `PLAYWRIGHT_BASE_URL` and `STAMP_CODE`.

## Stubbed / limits
- The registry does not store countersignature bytes. They are recovered in the browser only when the api supplies `countersig` (66 bytes). Otherwise the page reports that the chain checked them at registration.
- Provider `/piece` URLs come from the api's presentation. Without the api, the exact path uses FilBeam and the mirror, and `ServiceProviderRegistry` is not read yet.
- ERC-1271 device keys are shown as checked by the chain, not re-checked in the browser.
