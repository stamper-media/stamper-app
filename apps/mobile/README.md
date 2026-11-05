# @stamper/mobile — Expo capture app

Live capture (photo, and video up to 180 s / 500 MB), EXIF/MP4 minimisation before hashing, sha256 and
PieceCID, EIP-712 claim signing with a software secp256k1 key, App Attest / Play Integrity binding,
resumable upload, an encrypted offline queue, and the "first three minutes" UX with share gating
(DESIGN §7, §8.4). Expo SDK 57 (`expo@57.0.26`, React Native 0.86.3, expo-router). No custom native modules.

## Modules (`lib/`)
| File | API |
|---|---|
| `keys.ts` | `getOrCreateDeviceKey()`, `signTypedDataWithDeviceKey()`, `nextClaimNonce()`, `resetDeviceKey()`, `setSecretStore()` (key in expo-secure-store, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`) |
| `attestation/` | `DeviceAttestation`, `createDeviceAttestation('real'\|'stub')`, `createAppIntegrityAttestation`, `createStubAttestation`, `stubToken` |
| `enrol.ts` | `enrolDevice(api, att)`, `getEnrolment()`, `bindingOf(a, challenge)` |
| `capture.ts` | `capturePhoto`, `captureVideo`, `prepareJpeg` (minimise → hash input), `choosePhysicalLens` |
| `hash.ts` | `hashPhoto(bytes)` (`PIECE_IMPL='fr32'`), `sha256File(uri)` (quick-crypto, 1 MiB reads), `sha256Stream` |
| `claim.ts` | `buildRecord`, `buildClaim`, `assembleClaim`, `signClaim`, `claimToWire`/`claimFromWire` |
| `location.ts` | opt-in "Record location" (DESIGN §11.3, off by default, last choice remembered): `readCaptureLocation(provider)` (one expo-location fix, 5 s timeout; denied or no fix → captured without location), `locationRecord` (public 0.01° cell + DAG-CBOR `PrivateRecord` under a 32-byte CSPRNG salt), `get/setRecordLocationPref` |
| `api.ts` | `createApiClient(baseUrl)`: typed, zod-validated client for the WP-07 `/v1` DTOs, with 429/5xx back-off capped at the api's `RATE_WINDOW_MS` |
| `upload.ts` | `uploadResumable(api, uploadId, reader)`: Content-Range PUT, resumes from HEAD, re-syncs on 409 |
| `queue.ts` | `CaptureQueue` (KV-backed, ordered drain, retry back-off), `openPersistentQueue()` (encrypted MMKV) |
| `pipeline.ts` | `createStep(deps)`, `stageCapture()`: captured → signed → uploaded → claimSent (video: the server PieceCID is used after a local sha256 check) |
| `status.ts` | `reduceStatus`, `canShare`, `codeView`, `pollStatus`, `statusFromItem` |
| `copy.ts` | every UI string (tier sentences and the footer come from `@stamper/core`) |

Screens: `app/(tabs)/{index,gallery,settings}.tsx`, `app/enrol.tsx`, `app/stamp/[captureId].tsx`,
`app/verify/[code].tsx` (+ `app/v/[code].tsx` for App Links). Components: `CameraView`, `CodeDisplay`,
`ShareSheetGate`, `PreviewBadge` (Skia, watermarked "preview").

## Env (`EXPO_PUBLIC_*`)
`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_CHAIN_ID` (314 | 314159 | 31337), `EXPO_PUBLIC_REGISTRY_ADDRESS`,
`EXPO_PUBLIC_VERIFY_BASE_URL` (overrides `extra.publicOrigin`, which is the only place the public
origin is set), `EXPO_PUBLIC_ATTEST_MODE=real|stub`, `EXPO_PUBLIC_PLAY_CLOUD_PROJECT_NUMBER`.
Build-time: `APPLE_APP_ATTEST_ENV=production|development`, `EAS_PROJECT_ID`. Bundle id / package:
`media.stamper.app` (placeholder).

## Tests
```
pnpm --filter @stamper/core build && pnpm --filter @stamper/minimise build
pnpm --filter @stamper/mobile typecheck
pnpm --filter @stamper/mobile test          # jest-expo
flock ../../.heavy.flock node scripts/spike-piece-hermes.ts   # Metro/Hermes bundle spike
```
`jest.resolver.js` mirrors Metro's `import` / `browser` fallbacks for ESM-only dependencies.
The suite covers: core claim vectors (stampId, signature, code), minimised bytes as the hash input
(GPS removed, Orientation kept), the offline queue across restarts, the share-gating state machine,
resumable upload, attestation encodings, the pipeline against an in-memory api that applies the
§7.4 checks, and opt-in location (cell + private record, online and offline; denied or late fix →
captured without location).

## Development builds and Maestro (manual, needs a device or emulator)
1. `npx expo prebuild && npx expo run:android` (Android SDK + JDK 17), or `eas build --profile development`.
2. Start the WP-12 local stack with `ATTEST_MODE=stub`, then set `EXPO_PUBLIC_API_URL` to it and
   `EXPO_PUBLIC_ATTEST_MODE=stub`.
3. `maestro test .maestro/capture-and-register.yaml`.
Real attestation needs TestFlight / Play internal-track builds; App Attest and Play Integrity do not
work in simulators or Expo Go. The device allowlist is enforced server-side (WP-07).

## Stubbed / not done here
- Stub attestation (`stub:<platform>:<hex>`) for simulators and anvil stacks. Strict servers reject it.
- No native build was run on this host. Maestro flows, device hash timings, the background upload
  session and real attestation have not been exercised.
- The record's `attestation.bundleHash` is zero, because only the server knows the bundle hash.
  `privateHash` is null unless "Record location" recorded a fix: then the record carries the ~1 km cell,
  `privateHash` commits to the private record (salt + exact fix), and the claim sends that record as
  `privateRecord` for the api to seal. The queue item keeps it (`privateRecord`) for a later reveal. Full EXIF
  and sensor evidence in the private record are v1.
- Uploads use chunked `fetch` PUTs (resumable). The iOS background-session `File.createUploadTask`
  path is not wired, because the api requires sequential Content-Range chunks.
- `spikes/hermes-piece.md` holds the spike record (the plan path `docs/spikes/` is outside this package).
