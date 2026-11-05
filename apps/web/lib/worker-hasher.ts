"use client";
import type { Hex } from "viem";
import type { Digests, StreamHasher } from "./hashing";

/** StreamHasher backed by workers/hash.worker.ts (keeps hashing off the main thread). */
export function createWorkerHasher(): StreamHasher {
  const w = new Worker(new URL("../workers/hash.worker.ts", import.meta.url), { type: "module" });
  let length = 0;
  return {
    update(chunk) {
      length += chunk.byteLength;
      const copy = chunk.slice().buffer;
      w.postMessage({ type: "chunk", data: copy }, [copy]);
    },
    digest() {
      return new Promise<Digests>((resolve, reject) => {
        w.onmessage = (ev: MessageEvent) => {
          const m = ev.data as {
            type: string;
            sha256?: string;
            pieceCid?: string;
            message?: string;
          };
          w.terminate();
          if (m.type === "digest") {
            resolve({ sha256: m.sha256 as Hex, pieceCid: m.pieceCid as Hex, length });
          } else reject(new Error(m.message ?? "hash worker failed"));
        };
        w.onerror = (e) => {
          w.terminate();
          reject(new Error(e.message || "hash worker failed"));
        };
        w.postMessage({ type: "end" });
      });
    },
    abort() {
      w.terminate();
    },
  };
}

/** Hash a whole Blob in the worker, streaming it in 1 MiB slices. */
export async function hashBlob(
  blob: Blob,
  make: () => StreamHasher = createWorkerHasher,
): Promise<Digests> {
  const h = make();
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    await h.update(value);
  }
  return h.digest();
}
