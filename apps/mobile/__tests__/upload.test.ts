import { ApiError } from "../lib/api";
import { uploadResumable } from "../lib/upload";
import { fakeApi } from "./helpers/fakeApi";

const domain = {
  chainId: 31337 as const,
  registry: "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const,
};
const bytes = Uint8Array.from({ length: 10_000 }, (_, i) => (i * 7) & 0xff);
const reader = { size: bytes.length, read: async (o: number, l: number) => bytes.slice(o, o + l) };

describe("uploadResumable", () => {
  it("resumes from HEAD after a dropped connection and recovers a lost completion", async () => {
    const f = fakeApi(domain);
    const uploads: Record<string, number[]> = {};
    // minimal in-place server: reuse fakeApi's upload handlers through a manual upload id
    const api = {
      ...f.api,
      uploadOffset: async (id: string) => (uploads[id] ?? []).length,
      uploadChunk: async (id: string, start: number, total: number, body: Uint8Array) => {
        if (!uploads[id]) uploads[id] = [];
        const buf = uploads[id];
        if (start + body.length === total && buf.length === total) {
          return {
            done: true as const,
            result: {
              sha256: "0x00",
              pieceCid: "b",
              pieceCidHex: "0x01",
              size: String(total),
            } as never,
          };
        }
        if (start !== buf.length)
          throw Object.assign(new ApiError(409, "RangeGap"), {
            range: `bytes=0-${buf.length - 1}`,
          });
        if (start === 4096 && !drops.done) {
          drops.done = true;
          buf.push(...body.subarray(0, 100));
          throw new ApiError(0, "NetworkError", undefined, true);
        }
        buf.push(...body);
        if (buf.length === total && !drops.lost) {
          drops.lost = true;
          throw new ApiError(0, "NetworkError", undefined, true); // completion response lost
        }
        return buf.length < total
          ? { done: false as const, next: buf.length }
          : {
              done: true as const,
              result: {
                sha256: "0x00",
                pieceCid: "b",
                pieceCidHex: "0x01",
                size: String(total),
              } as never,
            };
      },
    };
    const drops = { done: false, lost: false };
    const progress: number[] = [];
    const res = await uploadResumable(api, "u1", reader, {
      chunkSize: 4096,
      onProgress: (s) => progress.push(s),
    });
    expect(res.size).toBe("10000");
    expect(Uint8Array.from(uploads.u1 ?? [])).toEqual(bytes);
    expect(drops).toEqual({ done: true, lost: true });
    expect(progress.at(-1)).toBe(10_000);
  });

  it("gives up after repeated stalls with a retryable error", async () => {
    const f = fakeApi(domain);
    const api = {
      ...f.api,
      uploadOffset: async () => 0,
      uploadChunk: async () => {
        throw new ApiError(503, "HTTP503", undefined, true);
      },
    };
    await expect(uploadResumable(api, "u", reader, { maxStalls: 2 })).rejects.toMatchObject({
      code: "UploadStalled",
      retryable: true,
    });
  });

  it("surfaces non-retryable errors", async () => {
    const f = fakeApi(domain);
    const api = {
      ...f.api,
      uploadOffset: async () => 0,
      uploadChunk: async () => {
        throw new ApiError(413, "LengthOutOfBounds");
      },
    };
    await expect(uploadResumable(api, "u", reader)).rejects.toMatchObject({
      code: "LengthOutOfBounds",
    });
  });
});
