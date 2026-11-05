import { MEDIA } from "@stamper/core";
import type { Hex } from "viem";
import { type ApiClient, ApiError } from "./api";
import type { DeviceAttestation } from "./attestation/types";
import { fromBase64, toBase64 } from "./bytes";
import { buildClaim, type CaptureMeta, claimToWire, type StampDomain, signClaim } from "./claim";
import { bindingOf } from "./enrol";
import type { CaptureLocation } from "./location";
import { type CaptureQueue, type QueueItem, type SignedClaim, StepError } from "./queue";
import type { ByteReader } from "./upload";
import { uploadResumable } from "./upload";

/** File access used by the pipeline (expo-file-system in the app, memory in tests). */
export interface FileAccess {
  readAll(uri: string): Promise<Uint8Array>;
  open(uri: string): ByteReader & { close(): void };
  sha256(uri: string): Promise<Hex>;
}

export type PipelineDeps = {
  api: ApiClient;
  att: DeviceAttestation;
  domain: StampDomain;
  keyId: Hex;
  files: FileAccess;
  nextNonce: () => Promise<bigint>;
  sign?: (domain: StampDomain, claim: Parameters<typeof signClaim>[1]) => Promise<Hex>;
};

const lower = (h: string) => h.toLowerCase();
/** Claim errors that a fresh challenge and a new signature fix (online claims only). */
const RESIGN = new Set(["ChallengeInvalid", "Expired", "NonceUsed"]);

async function signItem(
  d: PipelineDeps,
  item: QueueItem,
  challenge: Hex | null,
  server?: {
    contentHash: Hex;
    pieceCidHex: Hex;
    contentLength: number;
  },
): Promise<SignedClaim> {
  const bytes = server ? undefined : await d.files.readAll(item.fileUri);
  const built = await buildClaim({
    ...item.meta,
    domain: d.domain,
    keyId: d.keyId,
    nonce: await d.nextNonce(),
    serverChallenge: challenge,
    attestationKind: d.att.kind,
    ...(bytes ? { bytes } : {}),
    ...(server ? { serverComputed: server } : {}),
    ...(item.privateRecord ? { privateRecord: fromBase64(item.privateRecord) } : {}),
  });
  const sig = await (d.sign ?? signClaim)(d.domain, built.claim);
  return {
    claim: claimToWire(built.claim),
    sig,
    record: toBase64(built.record),
    stampId: built.stampId,
    predictedCode: built.predictedCode,
  };
}

/** Signs a photo at capture time without a server challenge (offline, DESIGN §7.5). */
export async function signOffline(d: PipelineDeps, item: QueueItem): Promise<SignedClaim> {
  return signItem(d, item, null);
}

async function upload(d: PipelineDeps, uploadId: string, uri: string) {
  const reader = d.files.open(uri);
  try {
    return await uploadResumable(d.api, uploadId, reader);
  } finally {
    reader.close();
  }
}

function wrap(e: unknown): never {
  if (e instanceof StepError) throw e;
  if (e instanceof ApiError) throw new StepError(`${e.code}`, e.retryable || e.status === 0);
  throw e;
}

/**
 * One state transition of a queued capture:
 * photo: captured → (challenge, hash, sign) signed → uploaded → (attest, claim) claimSent
 * video: captured → (challenge, upload) uploaded → (sha256 check, sign, attest, claim) claimSent
 */
export function createStep(d: PipelineDeps) {
  return async (item: QueueItem): Promise<QueueItem> => {
    try {
      const isVideo = item.meta.mediaKind === MEDIA.VIDEO;
      switch (item.state) {
        case "captured": {
          const capture = await d.api.createCapture({
            keyId: d.keyId,
            mediaKind: item.meta.mediaKind,
          });
          if (isVideo) {
            const up = await upload(d, capture.uploadId, item.fileUri);
            return { ...item, capture, upload: up, state: "uploaded" };
          }
          const signed = await signItem(d, item, capture.challenge);
          return { ...item, capture, signed, state: "signed" };
        }
        case "signed": {
          const capture =
            item.capture ??
            (await d.api.createCapture({ keyId: d.keyId, mediaKind: item.meta.mediaKind }));
          const up = await upload(d, capture.uploadId, item.fileUri);
          return { ...item, capture, upload: up, state: "uploaded" };
        }
        case "uploaded": {
          const { capture, upload: up } = item;
          if (!capture || !up) throw new StepError("uploaded item lacks capture/upload", false);
          let signed = item.signed;
          if (isVideo && !signed) {
            const local = await d.files.sha256(item.fileUri);
            if (lower(local) !== lower(up.sha256)) {
              throw new StepError("Server sha256 differs from the local file", false);
            }
            signed = await signItem(d, item, capture.challenge, {
              contentHash: local,
              pieceCidHex: up.pieceCidHex,
              contentLength: Number(up.size),
            });
          }
          if (!signed) throw new StepError("uploaded photo has no signed claim", false);
          if (lower(up.sha256) !== lower(signed.claim.contentHash)) {
            throw new StepError("Uploaded bytes hash differently from the claim", false);
          }
          const att = await d.att.assertCapture(bindingOf(signed.stampId, capture.challenge));
          try {
            const accepted = await d.api.submitClaim(capture.captureId, {
              claim: signed.claim,
              sig: signed.sig,
              record: signed.record,
              attestation: { ...att, challengeId: capture.challengeId },
              ...(item.privateRecord ? { privateRecord: item.privateRecord } : {}),
            });
            return { ...item, signed, accepted, state: "claimSent" };
          } catch (e) {
            if (e instanceof ApiError && RESIGN.has(e.code)) {
              // New capture + challenge, new nonce, new signature; the old prediction never resolves.
              const reset: Partial<QueueItem> = { state: "captured", offline: false };
              (reset as Record<string, unknown>).capture = undefined;
              (reset as Record<string, unknown>).signed = undefined;
              (reset as Record<string, unknown>).upload = undefined;
              throw new StepError(e.code, true, reset);
            }
            throw e;
          }
        }
        default:
          return item;
      }
    } catch (e) {
      return wrap(e);
    }
  };
}

/**
 * Puts a new capture in the queue; offline photos are signed immediately. `location` is present
 * when "Record location" was on: a recorded fix puts the cell in the record and keeps the private
 * record with the item, so an offline capture still sends it with its claim later.
 */
export async function stageCapture(
  d: PipelineDeps,
  queue: CaptureQueue,
  input: {
    id: string;
    fileUri: string;
    meta: CaptureMeta;
    online: boolean;
    location?: CaptureLocation;
  },
): Promise<QueueItem> {
  const loc = input.location;
  const recorded = loc?.status === "recorded" ? loc : undefined;
  const item = queue.enqueue({
    id: input.id,
    fileUri: input.fileUri,
    meta: recorded ? { ...input.meta, location: recorded.cell } : input.meta,
    state: "captured",
    offline: !input.online,
    ...(loc ? { locationStatus: loc.status } : {}),
    ...(recorded ? { privateRecord: toBase64(recorded.privateRecord) } : {}),
  });
  if (input.online || input.meta.mediaKind === MEDIA.VIDEO) return item;
  return queue.update(item.id, { signed: await signOffline(d, item), state: "signed" });
}
