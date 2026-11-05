import type { Address, Hex } from "viem";
import { z } from "zod";
import type { AttestationKind } from "./attestation/types";

/** Mirrors services/api shared rate-limit window: never back off longer than one window. */
export const RATE_WINDOW_MS = 60_000;

const hex = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/) as unknown as z.ZodType<Hex>;
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/) as unknown as z.ZodType<Hex>;
const id = z.string().min(1).max(64);

export const ChallengeResponse = z.object({
  challengeId: id,
  challenge: bytes32,
  expiresAt: z.string(),
});
export const EnrolResponse = z.object({
  keyId: bytes32,
  level: z.number().int(),
  txHash: bytes32,
  status: z.string(),
});
export const CaptureResponse = z.object({
  captureId: id,
  uploadId: id,
  challengeId: id,
  challenge: bytes32,
});
export const UploadComplete = z.object({
  sha256: bytes32,
  pieceCid: z.string(),
  pieceCidHex: hex,
  size: z.string(),
});
export const ClaimResponse = z.object({
  stampId: bytes32,
  predictedCode: z.string(),
  attempt: z.number().int(),
  status: z.string(),
});
export const CaptureStatus = z.object({
  status: z.string(),
  stampId: bytes32.nullable(),
  predictedCode: z.string().nullable(),
  code: z.string().optional(),
  registerTx: bytes32.optional(),
  registeredEpoch: z.string().optional(),
  shareReady: z.boolean(),
  marked: z.string().optional(),
  reissued: z.object({ newCaptureId: id }).optional(),
});

export type Challenge = z.infer<typeof ChallengeResponse>;
export type Enrolled = z.infer<typeof EnrolResponse>;
export type CaptureCreated = z.infer<typeof CaptureResponse>;
export type UploadDone = z.infer<typeof UploadComplete>;
export type ClaimAccepted = z.infer<typeof ClaimResponse>;
export type CaptureStatusDto = z.infer<typeof CaptureStatus>;

/** Claim on the wire: uint64 as decimal strings (plan §4.1). */
export type ClaimWire = {
  contentHash: Hex;
  pieceCid: Hex;
  contentLength: string;
  mediaKind: 1 | 2;
  capturedAt: string;
  recordHash: Hex;
  keyId: Hex;
  nonce: string;
  flags: number;
  deadline: string;
};

export type EnrolBody = {
  addr: Address;
  keyId: Hex;
  platform: "ios" | "android";
  keyType: 0;
  popSig: Hex;
  attestation: {
    kind: AttestationKind;
    keyId?: string;
    attestationObject?: string;
    token?: string;
    challengeId: string;
  };
  appInfo: { id: string; version: string; build: string };
};

export type ClaimBody = {
  claim: ClaimWire;
  sig: Hex;
  record: string;
  attestation: { kind: AttestationKind; assertion?: string; token?: string; challengeId: string };
  /** base64 canonical DAG-CBOR PrivateRecord; required when the record carries a location. */
  privateRecord?: string;
};

export type ChunkResult = { done: true; result: UploadDone } | { done: false; next: number };

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: unknown,
    readonly retryable = false,
  ) {
    super(`${status} ${code}`);
  }
}

export interface ApiClient {
  readonly baseUrl: string;
  challenge(keyId?: Hex): Promise<Challenge>;
  enrol(body: EnrolBody): Promise<Enrolled>;
  createCapture(body: {
    keyId: Hex;
    mediaKind: 1 | 2;
    expectedSize?: string;
  }): Promise<CaptureCreated>;
  /** Next byte offset the server expects (0 when nothing is staged). */
  uploadOffset(uploadId: string): Promise<number>;
  uploadChunk(
    uploadId: string,
    start: number,
    total: number,
    body: Uint8Array,
  ): Promise<ChunkResult>;
  submitClaim(captureId: string, body: ClaimBody): Promise<ClaimAccepted>;
  captureStatus(captureId: string): Promise<CaptureStatusDto>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type ApiOptions = {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Retries for 429 / 5xx / network failures. */
  retries?: number;
  timeoutMs?: number;
};

/** `Range: bytes=0-N` → N+1; missing → 0. */
export function parseRangeHeader(h: string | null): number {
  if (!h) return 0;
  const m = /^bytes=0-(\d+)$/.exec(h.trim());
  if (!m) throw new ApiError(502, "BadRangeHeader", h);
  return Number(m[1]) + 1;
}

export function backoffMs(attempt: number, retryAfter: string | null): number {
  const ra = retryAfter ? Number(retryAfter) : Number.NaN;
  if (Number.isFinite(ra) && ra >= 0) return Math.min(ra * 1000, RATE_WINDOW_MS);
  return Math.min(500 * 2 ** attempt, RATE_WINDOW_MS);
}

export function createApiClient(baseUrl: string, opts: ApiOptions = {}): ApiClient {
  const base = baseUrl.replace(/\/+$/, "");
  const doFetch = opts.fetch ?? ((u, i) => fetch(u, i));
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const retries = opts.retries ?? 4;
  const timeoutMs = opts.timeoutMs ?? 60_000;

  async function send(path: string, init: RequestInit, ok: number[]): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        res = await doFetch(`${base}${path}`, { ...init, signal: ctl.signal });
      } catch (e) {
        if (attempt >= retries) throw new ApiError(0, "NetworkError", String(e), true);
        await sleep(backoffMs(attempt, null));
        continue;
      } finally {
        clearTimeout(timer);
      }
      if (ok.includes(res.status)) return res;
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < retries) {
        await sleep(backoffMs(attempt, res.headers.get("retry-after")));
        continue;
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      const code =
        body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error
          : `HTTP${res.status}`;
      throw Object.assign(new ApiError(res.status, code, body, retryable), {
        range: res.headers.get("range"),
      });
    }
  }

  async function json<T>(schema: z.ZodType<T>, res: Response): Promise<T> {
    const r = schema.safeParse(await res.json());
    if (!r.success) throw new ApiError(502, "BadResponse", r.error.issues[0]?.message);
    return r.data;
  }
  const post = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const enc = encodeURIComponent;

  return {
    baseUrl: base,
    async challenge(keyId) {
      const q = keyId ? `?keyId=${enc(keyId)}` : "";
      return json(ChallengeResponse, await send(`/v1/attest/challenge${q}`, {}, [200]));
    },
    async enrol(body) {
      return json(
        EnrolResponse,
        await send(`/v1/devices/${body.platform}`, post(body), [200, 201]),
      );
    },
    async createCapture(body) {
      return json(CaptureResponse, await send("/v1/captures", post(body), [200, 201]));
    },
    async uploadOffset(uploadId) {
      const res = await send(`/v1/uploads/${enc(uploadId)}`, { method: "HEAD" }, [200, 204]);
      return parseRangeHeader(res.headers.get("range"));
    },
    async uploadChunk(uploadId, start, total, body) {
      if (body.length === 0) throw new RangeError("empty chunk");
      const end = start + body.length - 1;
      const res = await send(
        `/v1/uploads/${enc(uploadId)}`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/octet-stream",
            "content-range": `bytes ${start}-${end}/${total}`,
          },
          body: body as unknown as BodyInit,
        },
        [200, 201, 308],
      );
      if (res.status === 308)
        return { done: false, next: parseRangeHeader(res.headers.get("range")) };
      return { done: true, result: await json(UploadComplete, res) };
    },
    async submitClaim(captureId, body) {
      return json(
        ClaimResponse,
        await send(`/v1/captures/${enc(captureId)}/claim`, post(body), [200, 202]),
      );
    },
    async captureStatus(captureId) {
      return json(CaptureStatus, await send(`/v1/captures/${enc(captureId)}`, {}, [200]));
    },
  };
}
