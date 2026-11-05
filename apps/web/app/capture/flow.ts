/**
 * WP-14 browser capture flow against the custodian api (plan §WP-07 wire contracts):
 * enrol (once) → POST /v1/captures → PUT /v1/uploads/:id → sign the CaptureClaim with the browser
 * key → POST /v1/captures/:id/claim with attestation "none" → poll GET /v1/captures/:id.
 * Pure orchestration with injected fetch, hasher and key store, so it runs under vitest on Node.
 */
import {
  type CaptureClaim,
  type CaptureRecord,
  claimDeadline,
  encodeRecord,
  hashCaptureClaim,
  MEDIA,
  recordHash,
} from "@stamper/core";
import type { Hex } from "viem";
import type { Digests } from "../../lib/hashing";
import {
  loadOrCreateWebKey,
  possessionDigest,
  type StamperDomain,
  type StoredWebKey,
  signDigest,
  type WebKeyStore,
} from "../../lib/webkey";
import { prepareMedia, UnsupportedMedia } from "./prepare";

export const MAX_WEB_BYTES = 100 * 1024 * 1024;
const ZERO32: Hex = `0x${"00".repeat(32)}`;

export type Step =
  | "key"
  | "enrol"
  | "hash"
  | "open"
  | "upload"
  | "sign"
  | "submit"
  | "wait"
  | "done";

export type MediaMeta = {
  mediaType: string;
  dims: { w: number; h: number; durationMs?: number };
  facing?: "front" | "back";
};

export type CaptureDeps = {
  apiUrl: string;
  domain: StamperDomain;
  appInfo: { id: string; version: string; build: string };
  store: WebKeyStore;
  hash: (blob: Blob) => Promise<Digests>;
  fetch?: typeof fetch;
  subtle?: SubtleCrypto;
  now?: () => number;
  onStep?: (s: Step) => void;
  sleep?: (ms: number) => Promise<void>;
  /** how long to poll for the final code (ms); 0 skips polling. */
  pollForMs?: number;
};

export type CaptureResult = {
  captureId: string;
  stampId: Hex;
  /** final code once the chain recorded the stamp, else the predicted one. */
  code: string;
  final: boolean;
};

export class CaptureError extends Error {
  constructor(
    readonly code: string,
    readonly status = 0,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export function mediaKindOf(mediaType: string): 1 | 2 {
  if (mediaType.startsWith("image/")) return MEDIA.IMAGE as 1;
  if (mediaType.startsWith("video/")) return MEDIA.VIDEO as 2;
  throw new CaptureError("UnsupportedType");
}

function randomNonce(): bigint {
  const b = new Uint32Array(2);
  globalThis.crypto.getRandomValues(b);
  // 63 bits: unique per key in practice, and the server rejects reuse with NonceUsed
  return ((BigInt(b[0] as number) & 0x7fffffffn) << 32n) | BigInt(b[1] as number);
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function createApi(apiUrl: string, f: typeof fetch = fetch) {
  const base = apiUrl.replace(/\/+$/, "");
  return async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    let r: Response;
    try {
      r = await f(`${base}${path}`, init);
    } catch (e) {
      throw new CaptureError("Network", 0, e instanceof Error ? e.message : String(e));
    }
    const text = await r.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!r.ok) {
      const b = (body ?? {}) as { error?: string; reason?: string };
      throw new CaptureError(b.error ?? `HTTP${r.status}`, r.status, b.reason);
    }
    return body as T;
  };
}

const jsonInit = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Enrols the browser key once (level 0, no attestation). */
export async function ensureEnrolled(deps: CaptureDeps): Promise<StoredWebKey> {
  const call = createApi(deps.apiUrl, deps.fetch);
  deps.onStep?.("key");
  const k = await loadOrCreateWebKey(deps.store, deps.subtle);
  if (k.enrolled) return k;
  deps.onStep?.("enrol");
  const ch = await call<{ challengeId: string }>(`/v1/attest/challenge?keyId=${k.keyId}`);
  const popSig = await signDigest(k.privateKey, possessionDigest(deps.domain, k), deps.subtle);
  try {
    await call(
      "/v1/devices/web",
      jsonInit({
        keyId: k.keyId,
        x: k.x,
        y: k.y,
        popSig,
        challengeId: ch.challengeId,
        appInfo: deps.appInfo,
      }),
    );
  } catch (e) {
    if (!(e instanceof CaptureError && e.code === "KeyExists")) throw e;
  }
  const done = { ...k, enrolled: true };
  await deps.store.put(done);
  return done;
}

/** Stamps one photo or video (camera frame and upload are treated identically). */
export async function stampBlob(
  input: Blob,
  inputMeta: MediaMeta,
  deps: CaptureDeps,
): Promise<CaptureResult> {
  const call = createApi(deps.apiUrl, deps.fetch);
  const now = deps.now ?? Date.now;
  if (input.size < 1) throw new CaptureError("Empty");
  if (input.size > MAX_WEB_BYTES) throw new CaptureError("TooLarge");
  // Minimise metadata first (GPS, serials, MakerNote, MP4 udta out; Orientation kept or added): the
  // minimised bytes are what gets hashed, signed, uploaded and stored.
  let prep: ReturnType<typeof prepareMedia>;
  try {
    prep = prepareMedia(new Uint8Array(await input.arrayBuffer()));
  } catch (e) {
    if (e instanceof UnsupportedMedia) throw new CaptureError("UnsupportedType");
    throw new CaptureError("MetadataMalformed", 0, e instanceof Error ? e.message : String(e));
  }
  const blob = new Blob([prep.bytes as BlobPart], { type: prep.mediaType });
  const meta: MediaMeta = {
    ...inputMeta,
    mediaType: prep.mediaType,
    dims: prep.dims ? { ...inputMeta.dims, ...prep.dims } : inputMeta.dims,
  };
  const mediaKind = mediaKindOf(meta.mediaType);

  const key = await ensureEnrolled(deps);
  deps.onStep?.("hash");
  const dg = await deps.hash(blob);
  if (dg.length !== blob.size) throw new CaptureError("HashLength");

  deps.onStep?.("open");
  const cap = await call<{
    captureId: string;
    uploadId: string;
    challengeId: string;
    challenge: Hex;
  }>("/v1/captures", jsonInit({ keyId: key.keyId, mediaKind, expectedSize: String(blob.size) }));

  deps.onStep?.("upload");
  const up = await call<{ sha256: Hex; pieceCidHex: Hex; size: string }>(
    `/v1/uploads/${cap.uploadId}`,
    {
      method: "PUT",
      headers: {
        "content-range": `bytes 0-${blob.size - 1}/${blob.size}`,
        "content-type": "application/octet-stream",
      },
      body: blob,
    },
  );
  if (
    up.sha256.toLowerCase() !== dg.sha256.toLowerCase() ||
    up.pieceCidHex.toLowerCase() !== dg.pieceCid.toLowerCase() ||
    up.size !== String(blob.size)
  )
    throw new CaptureError("UploadChanged");

  deps.onStep?.("sign");
  const capturedAt = BigInt(now());
  const rec: CaptureRecord = {
    v: 1,
    stampDomain: { chainId: deps.domain.chainId, registry: deps.domain.verifyingContract },
    contentHash: dg.sha256,
    pieceCid: dg.pieceCid,
    contentLength: blob.size,
    mediaType: meta.mediaType.slice(0, 100),
    dims: meta.dims,
    capturedAt: Number(capturedAt),
    monotonicNs: String(Math.round((globalThis.performance?.now() ?? 0) * 1e6)),
    platform: "web",
    app: deps.appInfo,
    capture: {
      source: "in-app-camera",
      facing: meta.facing ?? "back",
      lensId: "web",
      physicalCameraIds: [],
      physicalOnly: true,
    },
    serverChallenge: cap.challenge,
    offline: false,
    sanitised: prep.sanitised,
    publicExif: prep.publicExif,
    attestation: { kind: "none", bundleHash: ZERO32 },
    privateHash: null,
  };
  const record = encodeRecord(rec);
  const claim: CaptureClaim = {
    contentHash: dg.sha256,
    pieceCid: dg.pieceCid,
    contentLength: BigInt(blob.size),
    mediaKind,
    capturedAt,
    recordHash: recordHash(record),
    keyId: key.keyId,
    nonce: randomNonce(),
    flags: 0,
    deadline: claimDeadline(capturedAt, false),
  };
  const sig = await signDigest(key.privateKey, hashCaptureClaim(deps.domain, claim), deps.subtle);

  deps.onStep?.("submit");
  const res = await call<{ stampId: Hex; predictedCode: string }>(
    `/v1/captures/${cap.captureId}/claim`,
    jsonInit({
      claim: {
        ...claim,
        contentLength: claim.contentLength.toString(),
        capturedAt: claim.capturedAt.toString(),
        nonce: claim.nonce.toString(),
        deadline: claim.deadline.toString(),
      },
      sig,
      record: b64(record),
      attestation: { kind: "none", challengeId: cap.challengeId },
    }),
  );

  const out: CaptureResult = {
    captureId: cap.captureId,
    stampId: res.stampId,
    code: res.predictedCode,
    final: false,
  };
  // A browser's first stamp waits for its key to reach the chain, then for the stamp itself: a few
  // minutes on Calibration or mainnet. Past this window the predicted code is shown instead.
  const pollFor = deps.pollForMs ?? 10 * 60_000;
  if (pollFor > 0) {
    deps.onStep?.("wait");
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const until = now() + pollFor;
    while (now() < until) {
      const st = await call<{ code?: string; status: string }>(
        `/v1/captures/${cap.captureId}`,
      ).catch(() => null);
      if (st?.code) {
        out.code = st.code;
        out.final = true;
        break;
      }
      if (st?.status === "rejected") throw new CaptureError("Rejected");
      await sleep(5000);
    }
  }
  deps.onStep?.("done");
  return out;
}
