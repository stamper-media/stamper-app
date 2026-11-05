# stamper-app

Stamp a photo or video where it is taken. The web app hashes and signs the file in the browser
(a non-extractable WebCrypto P-256 key, level 0: "Registered upload — device not attested") and
registers it on chain through the Stamper api; the phone app (Expo, iOS and Android) does the same
with App Attest / Play Integrity (level 1). Profiles and galleries will live here too.

## Stamper repos

| Repo | What |
|---|---|
| [stamper-protocol](https://github.com/stamper-media/stamper-protocol) | FEVM contracts, the shared `@stamper/*` packages (npm), infra and design docs |
| [stamper-services](https://github.com/stamper-media/stamper-services) | custodian api + worker, ml sidecar, whole-flow e2e |
| [stamper-app](https://github.com/stamper-media/stamper-app) | stamp from the browser (web) and the phone (iOS, Android) |
| [stamper-explorer](https://github.com/stamper-media/stamper-explorer) | the public check site: stamp pages, QR, compare, check a file |

Clone them side by side (`stamper-protocol/`, `stamper-services/`, … in one folder): scripts that need
another repo look for it there, or in `STAMPER_<NAME>_DIR`.

## What is here

| Path | Package | What |
|---|---|---|
| `apps/web` | `@stamper/app` | Next.js: the capture screen (camera or file → minimise metadata → hash → sign → register) |
| `apps/mobile` | `@stamper/mobile` | Expo app: capture, enrolment, offline queue, share |

## Commands

```sh
pnpm install
pnpm dev                    # the web app on http://localhost:3000 (set NEXT_PUBLIC_API_URL, see below)
pnpm build && pnpm test
pnpm lint && pnpm typecheck
```

The web app needs the api (`stamper-services`, with `WEB_CAPTURE=1`) and the chain settings:
`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CHAIN_ID` (314159 on Calibration), `NEXT_PUBLIC_RPC_URLS`, and
`NEXT_PUBLIC_VERIFY_BASE_URL` (the Explorer, where stamp pages live). `stamper-services`'
`e2e/stack-calibration.sh` starts all of it against Calibration. The live browser test:
`PLAYWRIGHT_BASE_URL=http://localhost:13311 EXPLORER_BASE_URL=http://localhost:13310 LIVE_CAPTURE=1 pnpm --filter @stamper/app test:live`.

## @stamper/* packages

From npm once `stamper-protocol` publishes them; until then from `vendor/*.tgz` (`scripts/sync-protocol.sh`).

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
