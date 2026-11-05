/**
 * Streaming SHA-256 (hash-wasm) + PieceCIDv2 (synapse-core transformStream) over the same bytes.
 * Runs inside workers/hash.worker.ts in the browser; unit tests run it in-process.
 */
import * as Piece from "@filoz/synapse-core/piece";
import { pieceCidHex } from "@stamper/core";
import { createSHA256 } from "hash-wasm";
import type { Hex } from "viem";

export type Digests = { sha256: Hex; pieceCid: Hex; length: number };

export interface StreamHasher {
  update(chunk: Uint8Array): void | Promise<void>;
  digest(): Promise<Digests>;
  abort?(): void;
}

export async function createInlineHasher(): Promise<StreamHasher> {
  const sha = await createSHA256();
  sha.init();
  const pt = Piece.transformStream();
  const writer = pt.transform.writable.getWriter();
  const reader = pt.transform.readable.getReader();
  // drain the pass-through side so backpressure never stalls the writer
  const drained = (async () => {
    for (;;) {
      const { done } = await reader.read();
      if (done) return;
    }
  })();
  let length = 0;
  return {
    async update(chunk) {
      sha.update(chunk);
      length += chunk.byteLength;
      await writer.write(chunk);
    },
    async digest() {
      await writer.close();
      await drained;
      const cid = await pt.result;
      return { sha256: `0x${sha.digest("hex")}` as Hex, pieceCid: pieceCidHex(cid), length };
    },
  };
}

export async function digestBytes(bytes: Uint8Array): Promise<Digests> {
  const h = await createInlineHasher();
  const step = 1 << 20;
  for (let i = 0; i < bytes.length; i += step) await h.update(bytes.subarray(i, i + step));
  return h.digest();
}
