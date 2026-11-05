/// <reference lib="webworker" />
import { createInlineHasher, type StreamHasher } from "../lib/hashing";

type In = { type: "chunk"; data: ArrayBuffer } | { type: "end" } | { type: "reset" };
type Out =
  | { type: "digest"; sha256: string; pieceCid: string; length: number }
  | { type: "error"; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let hasher: Promise<StreamHasher> = createInlineHasher();
let queue: Promise<void> = Promise.resolve();

function post(m: Out): void {
  scope.postMessage(m);
}

scope.onmessage = (ev: MessageEvent<In>) => {
  const msg = ev.data;
  queue = queue.then(async () => {
    try {
      if (msg.type === "reset") {
        hasher = createInlineHasher();
      } else if (msg.type === "chunk") {
        await (await hasher).update(new Uint8Array(msg.data));
      } else {
        const d = await (await hasher).digest();
        post({ type: "digest", ...d });
        hasher = createInlineHasher();
      }
    } catch (e) {
      post({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  });
};
