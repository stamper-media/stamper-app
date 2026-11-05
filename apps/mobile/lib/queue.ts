import type { Hex } from "viem";
import type { CaptureCreated, ClaimAccepted, ClaimWire, UploadDone } from "./api";
import { toBase64Url } from "./bytes";
import type { CaptureMeta } from "./claim";
import type { LocationStatus } from "./location";

/** Persistent string key-value store (react-native-mmkv in the app, a Map in tests). */
export interface KV {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): unknown;
  getAllKeys(): string[];
}

export type QueueState = "captured" | "signed" | "uploaded" | "claimSent" | "failed";

export type SignedClaim = {
  claim: ClaimWire;
  sig: Hex;
  /** base64 DAG-CBOR CaptureRecord. */
  record: string;
  stampId: Hex;
  predictedCode: string;
};

export type QueueItem = {
  id: string;
  seq: number;
  fileUri: string;
  meta: CaptureMeta;
  state: QueueState;
  createdAt: number;
  /** Signed before any server challenge (DESIGN §7.5). */
  offline: boolean;
  /** Set when "Record location" was on for this capture: what came of it (DESIGN §11.3). */
  locationStatus?: LocationStatus;
  /**
   * base64 canonical DAG-CBOR PrivateRecord (salt + exact fix) that the record's privateHash
   * commits to. Sent with the claim (the api seals it) and kept here for a later reveal.
   */
  privateRecord?: string;
  capture?: CaptureCreated;
  signed?: SignedClaim;
  upload?: UploadDone;
  accepted?: ClaimAccepted;
  attempts: number;
  lastError?: string;
  /** Epoch ms before which drain skips the item (retry back-off). */
  notBefore?: number;
};

export type NewItem = Omit<QueueItem, "seq" | "attempts" | "createdAt"> & { createdAt?: number };
export type StepResult = { item: QueueItem; done: boolean };
/** Advances one item by one state; throws on failure. `retryable` errors keep queue order. */
export type Step = (item: QueueItem) => Promise<QueueItem>;

const PREFIX = "q:";
const SEQ = "q.seq";
const TERMINAL: QueueState[] = ["claimSent", "failed"];

export class StepError extends Error {
  override name = "StepError";
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly reset?: Partial<QueueItem>,
  ) {
    super(message);
  }
}

/** Offline capture queue: survives restarts, drains in capture order (DESIGN §7.5). */
export class CaptureQueue {
  constructor(
    private readonly kv: KV,
    private readonly now: () => number = Date.now,
  ) {}

  enqueue(item: NewItem): QueueItem {
    if (this.get(item.id)) throw new Error(`duplicate queue item ${item.id}`);
    const seq = Number(this.kv.getString(SEQ) ?? "0") + 1;
    this.kv.set(SEQ, String(seq));
    const full: QueueItem = { ...item, seq, attempts: 0, createdAt: item.createdAt ?? this.now() };
    this.write(full);
    return full;
  }

  get(id: string): QueueItem | undefined {
    const raw = this.kv.getString(PREFIX + id);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as QueueItem;
    } catch {
      return undefined;
    }
  }

  list(): QueueItem[] {
    return this.kv
      .getAllKeys()
      .filter((k) => k.startsWith(PREFIX))
      .map((k) => this.get(k.slice(PREFIX.length)))
      .filter((x): x is QueueItem => x !== undefined)
      .sort((a, b) => a.seq - b.seq);
  }

  pending(): QueueItem[] {
    return this.list().filter((i) => !TERMINAL.includes(i.state));
  }

  update(id: string, patch: Partial<QueueItem>): QueueItem {
    const cur = this.get(id);
    if (!cur) throw new Error(`unknown queue item ${id}`);
    const next = { ...cur, ...patch, id: cur.id, seq: cur.seq };
    this.write(next);
    return next;
  }

  remove(id: string): void {
    this.kv.remove(PREFIX + id);
  }

  private write(item: QueueItem): void {
    this.kv.set(PREFIX + item.id, JSON.stringify(item));
  }

  /**
   * Drains pending items in order. Each item is stepped until it reaches a terminal state.
   * A retryable failure stops the drain (later captures wait, preserving order); a permanent
   * failure marks the item failed and moves on.
   */
  async drain(
    step: Step,
    opts: { maxSteps?: number; backoffMs?: (attempts: number) => number } = {},
  ) {
    const maxSteps = opts.maxSteps ?? 10;
    const backoff = opts.backoffMs ?? ((n) => Math.min(60_000 * 2 ** n, 3_600_000));
    const processed: string[] = [];
    for (const start of this.pending()) {
      if (start.notBefore && start.notBefore > this.now()) return { processed, blocked: start.id };
      let item = start;
      for (let i = 0; i < maxSteps && !TERMINAL.includes(item.state); i++) {
        try {
          const next = await step(item);
          item = this.update(item.id, { ...next, lastError: undefined, notBefore: undefined });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const retryable = e instanceof StepError ? e.retryable : true;
          const reset = e instanceof StepError ? e.reset : undefined;
          const attempts = item.attempts + 1;
          if (reset) {
            item = this.update(item.id, { ...reset, attempts, lastError: msg });
            continue;
          }
          if (!retryable) {
            this.update(item.id, { state: "failed", attempts, lastError: msg });
            break;
          }
          this.update(item.id, {
            attempts,
            lastError: msg,
            notBefore: this.now() + backoff(attempts),
          });
          return { processed, blocked: item.id };
        }
      }
      processed.push(item.id);
    }
    return { processed, blocked: null as string | null };
  }
}

/** Encrypted MMKV instance; the encryption key lives in expo-secure-store. */
export async function openPersistentQueue(): Promise<CaptureQueue> {
  const SecureStore = await import("expo-secure-store");
  const slot = "stamper.queueKey.v1";
  let key = await SecureStore.getItemAsync(slot);
  if (!key) {
    // MMKV AES keys are at most 16 bytes of string: 16 chars of base64url carry 96 bits
    // (hex would carry only 64).
    const rnd = new Uint8Array(12);
    crypto.getRandomValues(rnd);
    key = toBase64Url(rnd);
    await SecureStore.setItemAsync(slot, key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
  // Loaded lazily: react-native-mmkv needs the NitroModules native module at import time.
  const { createMMKV } = await import("react-native-mmkv");
  const mmkv = createMMKV({ id: "stamper-queue", encryptionKey: key.slice(0, 16) });
  return new CaptureQueue(mmkv);
}
