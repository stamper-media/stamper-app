import {
  type ApproxLocation,
  type CaptureClaim,
  type CaptureRecord,
  captureClaimTypes,
  claimDeadline,
  type DomainChainId,
  decodePrivateRecord,
  encodeCode,
  encodeRecord,
  FLAG,
  fixInCell,
  formatCode,
  hashCaptureClaim,
  MEDIA,
  pieceCidHex,
  pieceCidString,
  predictCode,
  privateRecordHash,
  recordHash,
  stamperDomain,
  ZERO_BYTES32,
} from "@stamper/core";
import type { Address, Hex } from "viem";
import type { ClaimWire } from "./api";
import type { AttestationKind } from "./attestation/types";
import { hashPhoto } from "./hash";
import { signTypedDataWithDeviceKey } from "./keys";

export type StampDomain = { chainId: DomainChainId; registry: Address };

export type CaptureMeta = {
  mediaKind: 1 | 2;
  mediaType: string;
  dims: { w: number; h: number; durationMs?: number };
  capturedAtMs: number;
  monotonicNs: string;
  platform: "ios" | "android";
  app: { id: string; version: string; build: string };
  facing: "back" | "front";
  lensId: string;
  physicalCameraIds: string[];
  sanitised: { removed: string[]; kept: string[] };
  publicExif: Record<string, string | number>;
  /** Opt-in public cell (DESIGN §11.3); the exact fix is only in the private record. */
  location?: ApproxLocation;
};

export type RecordInput = CaptureMeta & {
  domain: StampDomain;
  contentHash: Hex;
  pieceCid: Hex;
  contentLength: number;
  serverChallenge: Hex | null;
  attestationKind: AttestationKind;
  /** Canonical DAG-CBOR PrivateRecord; its sha256 becomes the record's privateHash. */
  privateRecord?: Uint8Array;
};

/** CaptureRecord (DESIGN §3.4). The device cannot know the server's bundle hash: zero here. */
export function buildRecord(i: RecordInput): CaptureRecord {
  const offline = i.serverChallenge === null;
  const dims: CaptureRecord["dims"] = { w: i.dims.w, h: i.dims.h };
  if (i.dims.durationMs !== undefined) dims.durationMs = i.dims.durationMs;
  const record: CaptureRecord = {
    v: 1,
    stampDomain: { chainId: i.domain.chainId, registry: i.domain.registry },
    contentHash: i.contentHash,
    pieceCid: i.pieceCid,
    contentLength: i.contentLength,
    mediaType: i.mediaType,
    dims,
    capturedAt: i.capturedAtMs,
    monotonicNs: i.monotonicNs,
    platform: i.platform,
    app: i.app,
    capture: {
      source: "in-app-camera",
      facing: i.facing,
      lensId: i.lensId,
      physicalCameraIds: i.physicalCameraIds,
      physicalOnly: true,
    },
    serverChallenge: i.serverChallenge,
    offline,
    sanitised: i.sanitised,
    publicExif: i.publicExif,
    attestation: {
      kind: i.attestationKind === "stub" ? "none" : i.attestationKind,
      bundleHash: ZERO_BYTES32,
    },
    privateHash: i.privateRecord ? privateRecordHash(i.privateRecord) : null,
  };
  if (i.location) {
    // the api refuses a cell without the exact fix inside it; fail here, before anything is signed
    const fix = i.privateRecord ? decodePrivateRecord(i.privateRecord).location : undefined;
    if (!fix || !fixInCell(fix, i.location))
      throw new TypeError("a location cell needs the exact fix inside it in the private record");
    record.location = i.location;
  }
  return record;
}

export function formatPredicted(stampId: Hex): string {
  return formatCode(encodeCode(predictCode(stampId).code));
}

/** Hashes the claim (stampId = EIP-712 digest) and predicts the code (shown greyed only). */
export function assembleClaim(domain: StampDomain, claim: CaptureClaim) {
  const stampId = hashCaptureClaim(stamperDomain(domain.chainId, domain.registry), claim);
  return { claim, stampId, predictedCode: formatPredicted(stampId) };
}

export type BuildClaimInput = CaptureMeta & {
  domain: StampDomain;
  keyId: Hex;
  nonce: bigint;
  serverChallenge: Hex | null;
  attestationKind: AttestationKind;
  /** Minimised photo bytes; hashed on device. */
  bytes?: Uint8Array;
  /** Video path: sha256 checked locally, PieceCID computed by the api while staging. */
  serverComputed?: { contentHash: Hex; pieceCidHex: Hex; contentLength: number };
  /** Canonical DAG-CBOR PrivateRecord (salt + exact fix) committed by the record's privateHash. */
  privateRecord?: Uint8Array;
};

export type BuiltClaim = {
  claim: CaptureClaim;
  record: Uint8Array;
  recordHash: Hex;
  stampId: Hex;
  predictedCode: string;
  pieceCid: string | null;
};

export async function buildClaim(input: BuildClaimInput): Promise<BuiltClaim> {
  let contentHash: Hex;
  let pieceHex: Hex;
  let pieceText: string | null = null;
  let contentLength: number;
  let flags = 0;
  if (input.serverComputed) {
    if (input.mediaKind !== MEDIA.VIDEO) throw new TypeError("server PieceCID is for video only");
    ({ contentHash, pieceCidHex: pieceHex, contentLength } = input.serverComputed);
    flags |= FLAG.PIECECID_SERVER_COMPUTED;
  } else {
    if (!input.bytes) throw new TypeError("bytes are required when hashing on device");
    const h = await hashPhoto(input.bytes);
    contentHash = h.sha256;
    pieceHex = pieceCidHex(h.pieceCid);
    pieceText = pieceCidString(h.pieceCid);
    contentLength = input.bytes.length;
  }
  const offline = input.serverChallenge === null;
  if (offline) flags |= FLAG.OFFLINE;

  const record = encodeRecord(
    buildRecord({ ...input, contentHash, pieceCid: pieceHex, contentLength }),
  );
  const rh = recordHash(record);
  const capturedAt = BigInt(input.capturedAtMs);
  const claim: CaptureClaim = {
    contentHash,
    pieceCid: pieceHex,
    contentLength: BigInt(contentLength),
    mediaKind: input.mediaKind,
    capturedAt,
    recordHash: rh,
    keyId: input.keyId,
    nonce: input.nonce,
    flags,
    deadline: claimDeadline(capturedAt, offline),
  };
  const a = assembleClaim(input.domain, claim);
  return { ...a, record, recordHash: rh, pieceCid: pieceText };
}

export function signClaim(domain: StampDomain, claim: CaptureClaim): Promise<Hex> {
  return signTypedDataWithDeviceKey(
    stamperDomain(domain.chainId, domain.registry),
    captureClaimTypes,
    "CaptureClaim",
    claim,
  );
}

export function claimToWire(c: CaptureClaim): ClaimWire {
  return {
    contentHash: c.contentHash,
    pieceCid: c.pieceCid,
    contentLength: c.contentLength.toString(),
    mediaKind: c.mediaKind,
    capturedAt: c.capturedAt.toString(),
    recordHash: c.recordHash,
    keyId: c.keyId,
    nonce: c.nonce.toString(),
    flags: c.flags,
    deadline: c.deadline.toString(),
  };
}

export function claimFromWire(w: ClaimWire): CaptureClaim {
  return {
    ...w,
    contentLength: BigInt(w.contentLength),
    capturedAt: BigInt(w.capturedAt),
    nonce: BigInt(w.nonce),
    deadline: BigInt(w.deadline),
  };
}
