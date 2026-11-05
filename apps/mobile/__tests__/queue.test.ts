import { CaptureQueue, type QueueItem, StepError } from "../lib/queue";
import { memoryKV } from "./helpers/memory";

const meta = {
  mediaKind: 1 as const,
  mediaType: "image/jpeg",
  dims: { w: 1, h: 1 },
  capturedAtMs: 1,
  monotonicNs: "1",
  platform: "ios" as const,
  app: { id: "a", version: "1", build: "1" },
  facing: "back" as const,
  lensId: "Back Camera",
  physicalCameraIds: ["Back Camera"],
  sanitised: { removed: [], kept: [] },
  publicExif: {},
};
const add = (q: CaptureQueue, id: string) =>
  q.enqueue({ id, fileUri: `file:///${id}.jpg`, meta, state: "captured", offline: true });

/** captured → signed → uploaded → claimSent */
const NEXT: Record<string, QueueItem["state"]> = {
  captured: "signed",
  signed: "uploaded",
  uploaded: "claimSent",
};

describe("CaptureQueue", () => {
  it("persists across a simulated restart and drains in capture order", async () => {
    const kv = memoryKV();
    let t = 1000;
    const q1 = new CaptureQueue(kv, () => t++);
    for (const id of ["c", "a", "b"]) add(q1, id);

    // "restart": a new instance over the same storage
    const q2 = new CaptureQueue(memoryKV(kv.map), () => t++);
    expect(q2.list().map((i) => i.id)).toEqual(["c", "a", "b"]);

    const calls: string[] = [];
    const r = await q2.drain(async (item) => {
      calls.push(`${item.id}:${item.state}`);
      return { ...item, state: NEXT[item.state] ?? item.state };
    });
    expect(r).toEqual({ processed: ["c", "a", "b"], blocked: null });
    expect(calls.slice(0, 3)).toEqual(["c:captured", "c:signed", "c:uploaded"]);
    expect(calls.filter((c) => c.endsWith("captured"))).toEqual([
      "c:captured",
      "a:captured",
      "b:captured",
    ]);
    expect(q2.pending()).toEqual([]);
    expect(q2.list().every((i) => i.state === "claimSent")).toBe(true);
  });

  it("a retryable failure blocks later items and survives restart with its progress", async () => {
    const kv = memoryKV();
    let now = 0;
    const q = new CaptureQueue(kv, () => now);
    add(q, "first");
    add(q, "second");
    const r = await q.drain(async (item) => {
      if (item.id === "first" && item.state === "signed") throw new StepError("NetworkError", true);
      return { ...item, state: NEXT[item.state] ?? item.state };
    });
    expect(r.blocked).toBe("first");
    const restarted = new CaptureQueue(memoryKV(kv.map), () => now);
    const first = restarted.get("first");
    expect(first?.state).toBe("signed");
    expect(first?.attempts).toBe(1);
    expect(restarted.get("second")?.state).toBe("captured");
    // back-off respected
    expect((await restarted.drain(async (i) => i)).blocked).toBe("first");
    now = 10 * 3_600_000;
    const done = await restarted.drain(async (item) => ({
      ...item,
      state: NEXT[item.state] ?? item.state,
    }));
    expect(done.processed).toEqual(["first", "second"]);
  });

  it("a permanent failure marks the item failed and moves on", async () => {
    const q = new CaptureQueue(memoryKV());
    add(q, "bad");
    add(q, "good");
    const r = await q.drain(async (item) => {
      if (item.id === "bad") throw new StepError("BadSig", false);
      return { ...item, state: NEXT[item.state] ?? item.state };
    });
    expect(r.blocked).toBeNull();
    expect(q.get("bad")?.state).toBe("failed");
    expect(q.get("bad")?.lastError).toBe("BadSig");
    expect(q.get("good")?.state).toBe("claimSent");
  });

  it("a reset error rewinds the item (re-sign with a new challenge)", async () => {
    const q = new CaptureQueue(memoryKV());
    add(q, "x");
    let rejected = false;
    await q.drain(async (item) => {
      if (item.state === "uploaded" && !rejected) {
        rejected = true;
        throw new StepError("ChallengeInvalid", true, { state: "captured" });
      }
      return { ...item, state: NEXT[item.state] ?? item.state };
    });
    expect(q.get("x")?.state).toBe("claimSent");
    expect(q.get("x")?.attempts).toBe(1);
  });

  it("rejects duplicate ids", () => {
    const q = new CaptureQueue(memoryKV());
    add(q, "d");
    expect(() => add(q, "d")).toThrow(/duplicate/);
  });
});
