import type { CaptureStatusDto } from "../lib/api";
import {
  canShare,
  codeView,
  initialStatus,
  pollStatus,
  reduceStatus,
  type StampStatus,
  type StatusEvent,
} from "../lib/status";

const stampId = `0x${"11".repeat(32)}` as const;
const dto = (p: Partial<CaptureStatusDto>): CaptureStatusDto => ({
  status: "registering",
  stampId,
  predictedCode: "5VEB-TVRA-F",
  shareReady: false,
  ...p,
});
const run = (events: StatusEvent[], s: StampStatus = initialStatus) =>
  events.reduce(reduceStatus, s);

describe("status machine (DESIGN §8.4)", () => {
  it("walks the happy path and enables sharing only at the end", () => {
    const steps: StatusEvent[] = [
      { type: "hashing" },
      { type: "signed" },
      { type: "uploading" },
      { type: "claimAccepted", stampId, predictedCode: "5VEB-TVRA-F" },
      { type: "server", dto: dto({}) },
      { type: "server", dto: dto({ status: "registered", code: "5VEB-TVRA-F" }) },
      {
        type: "server",
        dto: dto({
          status: "marked",
          code: "5VEB-TVRA-F",
          shareReady: true,
          marked: "http://x/share.jpg",
        }),
      },
      { type: "markedDownloaded", uri: "file:///share.jpg" },
    ];
    let s = initialStatus;
    const phases: string[] = [];
    const shares: boolean[] = [];
    for (const e of steps) {
      s = reduceStatus(s, e);
      phases.push(s.phase);
      shares.push(canShare(s));
    }
    expect(phases).toEqual([
      "hashing",
      "signed",
      "uploading",
      "claimSent",
      "claimSent",
      "registered",
      "registered",
      "shareReady",
    ]);
    expect(shares).toEqual([false, false, false, false, false, false, false, true]);
  });

  it("shows the prediction greyed until the receipt", () => {
    const s = run([{ type: "claimAccepted", stampId, predictedCode: "5VEB-TVRA-F" }]);
    expect(codeView(s)).toEqual({ text: "5VEB-TVRA-F", definitive: false });
    const r = reduceStatus(s, {
      type: "server",
      dto: dto({ status: "registered", code: "MR58-TTN8-D" }),
    });
    expect(codeView(r)).toEqual({ text: "MR58-TTN8-D", definitive: true });
  });

  it("ignores shareReady/marked before the receipt and a download before the receipt", () => {
    const s = run([
      { type: "claimAccepted", stampId, predictedCode: "5VEB-TVRA-F" },
      { type: "server", dto: dto({ shareReady: true, marked: "http://x/share.jpg" }) },
      { type: "markedDownloaded", uri: "file:///early.jpg" },
    ]);
    expect(s.markedLocalUri).toBeUndefined();
    expect(canShare(s)).toBe(false);
  });

  it("never enables sharing before registered && marked (random sequences)", () => {
    const pool: StatusEvent[] = [
      { type: "hashing" },
      { type: "uploading" },
      { type: "claimAccepted", stampId, predictedCode: "5VEB-TVRA-F" },
      { type: "server", dto: dto({}) },
      { type: "server", dto: dto({ shareReady: true, marked: "http://x/a.jpg" }) },
      { type: "server", dto: dto({ status: "registered", code: "5VEB-TVRA-F" }) },
      {
        type: "server",
        dto: dto({
          status: "registered",
          code: "5VEB-TVRA-F",
          shareReady: true,
          marked: "http://x/a.jpg",
        }),
      },
      { type: "markedDownloaded", uri: "file:///a.jpg" },
      { type: "server", dto: dto({ status: "rejected" }) },
      { type: "server", dto: dto({ reissued: { newCaptureId: "n" } }) },
    ];
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed;
    };
    for (let n = 0; n < 2000; n++) {
      let s = initialStatus;
      for (let i = 0; i < 8; i++) {
        s = reduceStatus(s, pool[rnd() % pool.length] as StatusEvent);
        if (canShare(s)) {
          expect(s.code).toBeTruthy();
          expect(s.markedLocalUri).toBeTruthy();
          expect(s.markedUrl).toBeTruthy();
        }
      }
    }
  });

  it("re-issue and rejection are terminal and hide the prediction", () => {
    const s = run([
      { type: "claimAccepted", stampId, predictedCode: "5VEB-TVRA-F" },
      { type: "server", dto: dto({ reissued: { newCaptureId: "new-id" } }) },
      { type: "server", dto: dto({ status: "registered", code: "5VEB-TVRA-F" }) },
    ]);
    expect(s.phase).toBe("reissued");
    expect(s.reissuedTo).toBe("new-id");
    expect(codeView(s).text).toBeNull();
    expect(canShare(s)).toBe(false);
  });

  it("pollStatus downloads the marked file after the receipt and stops share-ready", async () => {
    const seq = [
      dto({}),
      dto({ status: "registered", code: "5VEB-TVRA-F" }),
      dto({
        status: "marked",
        code: "5VEB-TVRA-F",
        shareReady: true,
        marked: "http://x/share.jpg",
      }),
    ];
    let i = 0;
    const downloads: string[] = [];
    const api = {
      captureStatus: async () => seq[Math.min(i++, seq.length - 1)] as CaptureStatusDto,
    };
    const final = await pollStatus(api as never, "cap", {
      onUpdate: () => undefined,
      download: async (url) => {
        downloads.push(url);
        return "file:///local.jpg";
      },
      sleep: async () => undefined,
    });
    expect(final.phase).toBe("shareReady");
    expect(downloads).toEqual(["http://x/share.jpg"]);
    expect(canShare(final)).toBe(true);
  });
});
