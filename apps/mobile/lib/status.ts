import type { Hex } from "viem";
import type { ApiClient, CaptureStatusDto } from "./api";
import type { QueueItem } from "./queue";

/** DESIGN §8.4 / plan WP-10 state machine. */
export type Phase =
  | "captured"
  | "hashing"
  | "signed"
  | "uploading"
  | "claimSent"
  | "registered"
  | "shareReady"
  | "reissued"
  | "failed";

export type StampStatus = {
  phase: Phase;
  stampId?: Hex;
  predictedCode?: string;
  /** Definitive code, present only after the registration receipt. */
  code?: string;
  /** Marked derivative URL from the api (present once the worker rendered it). */
  markedUrl?: string;
  /** Local copy of the marked file; sharing needs it. */
  markedLocalUri?: string;
  reissuedTo?: string;
  error?: string;
};

export type StatusEvent =
  | { type: "hashing" }
  | { type: "signed" }
  | { type: "uploading" }
  | { type: "claimAccepted"; stampId: Hex; predictedCode: string }
  | { type: "server"; dto: CaptureStatusDto }
  | { type: "markedDownloaded"; uri: string }
  | { type: "failed"; error: string };

const ORDER: Phase[] = [
  "captured",
  "hashing",
  "signed",
  "uploading",
  "claimSent",
  "registered",
  "shareReady",
];
const REGISTERED = new Set(["registered", "marked", "stored"]);
const REJECTED = new Set(["rejected", "withdrawn", "takedown", "failed"]);

export const initialStatus: StampStatus = { phase: "captured" };

const isFinal = (p: Phase) => p === "reissued" || p === "failed";
const advance = (cur: Phase, to: Phase): Phase =>
  isFinal(cur) ? cur : ORDER.indexOf(to) > ORDER.indexOf(cur) ? to : cur;

function settle(s: StampStatus): StampStatus {
  if (isFinal(s.phase)) return s;
  // Share-ready only when the receipt exists AND the marked file is on the device.
  if (s.code && s.markedLocalUri) return { ...s, phase: "shareReady" };
  if (s.code) return { ...s, phase: advance(s.phase, "registered") };
  return s;
}

export function reduceStatus(s: StampStatus, e: StatusEvent): StampStatus {
  switch (e.type) {
    case "hashing":
    case "signed":
    case "uploading":
      return { ...s, phase: advance(s.phase, e.type) };
    case "claimAccepted":
      return {
        ...s,
        phase: advance(s.phase, "claimSent"),
        stampId: e.stampId,
        predictedCode: e.predictedCode,
      };
    case "server": {
      if (isFinal(s.phase)) return s;
      const d = e.dto;
      if (d.reissued) return { ...s, phase: "reissued", reissuedTo: d.reissued.newCaptureId };
      if (REJECTED.has(d.status)) return { ...s, phase: "failed", error: d.status };
      const next: StampStatus = {
        ...s,
        phase: advance(s.phase, "claimSent"),
        stampId: d.stampId ?? s.stampId,
        predictedCode: d.predictedCode ?? s.predictedCode,
      };
      if (d.code && REGISTERED.has(d.status)) next.code = d.code;
      if (next.code && d.shareReady && d.marked) next.markedUrl = d.marked;
      return settle(next);
    }
    case "markedDownloaded":
      if (!s.code || !s.markedUrl) return s; // never accept a marked file before the receipt
      return settle({ ...s, markedLocalUri: e.uri });
    case "failed":
      return { ...s, phase: "failed", error: e.error };
  }
}

export function canShare(s: StampStatus): boolean {
  return s.phase === "shareReady" && !!s.code && !!s.markedLocalUri;
}

/** What the code display shows: the prediction greyed until the receipt, then definitive. */
export function codeView(s: StampStatus): { text: string | null; definitive: boolean } {
  if (s.code) return { text: s.code, definitive: true };
  if (s.predictedCode && !isFinal(s.phase)) return { text: s.predictedCode, definitive: false };
  return { text: null, definitive: false };
}

export function needsMarkedDownload(s: StampStatus): boolean {
  return !!s.code && !!s.markedUrl && !s.markedLocalUri && !isFinal(s.phase);
}

/**
 * Polls GET /v1/captures/{id} (the "first three minutes") until share-ready, re-issue or failure.
 * `download` fetches the marked file once the receipt and the marked URL exist.
 */
export async function pollStatus(
  api: ApiClient,
  captureId: string,
  opts: {
    initial?: StampStatus;
    onUpdate: (s: StampStatus) => void;
    download: (url: string) => Promise<string>;
    intervalMs?: number;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
    signal?: { aborted: boolean };
  },
): Promise<StampStatus> {
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const interval = opts.intervalMs ?? 3_000;
  const deadline = Date.now() + (opts.timeoutMs ?? 15 * 60_000);
  let s = opts.initial ?? { phase: "claimSent" as Phase };
  while (!opts.signal?.aborted && Date.now() < deadline) {
    try {
      s = reduceStatus(s, { type: "server", dto: await api.captureStatus(captureId) });
      if (needsMarkedDownload(s) && s.markedUrl) {
        s = reduceStatus(s, { type: "markedDownloaded", uri: await opts.download(s.markedUrl) });
      }
      opts.onUpdate(s);
    } catch {
      // transient; keep polling
    }
    if (s.phase === "shareReady" || isFinal(s.phase)) return s;
    await sleep(interval);
  }
  return s;
}

/** Local status of a queued capture before the server knows about it. */
export function statusFromItem(item: QueueItem): StampStatus {
  switch (item.state) {
    case "captured":
      return { phase: item.offline ? "captured" : "hashing" };
    case "signed":
      return { phase: item.capture ? "uploading" : "signed" };
    case "uploaded":
      return { phase: "uploading" };
    case "claimSent":
      return item.accepted
        ? reduceStatus(initialStatus, {
            type: "claimAccepted",
            stampId: item.accepted.stampId,
            predictedCode: item.accepted.predictedCode || item.signed?.predictedCode || "",
          })
        : { phase: "claimSent" };
    case "failed":
      return { phase: "failed", ...(item.lastError ? { error: item.lastError } : {}) };
  }
}
