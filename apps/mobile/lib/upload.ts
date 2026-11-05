import { type ApiClient, ApiError, parseRangeHeader, type UploadDone } from "./api";

/** Random-access reader over the staged file (expo-file-system FileHandle in the app). */
export type ByteReader = {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
};

export type UploadOptions = {
  chunkSize?: number;
  /** Consecutive failures without progress before giving up (the queue retries later). */
  maxStalls?: number;
  onProgress?: (sent: number, total: number) => void;
};

export const DEFAULT_CHUNK = 4 * 1024 * 1024;

/**
 * Resumable PUT /v1/uploads/{id} with Content-Range (plan WP-07): resume from HEAD, sequential
 * chunks, re-sync on 409 RangeGap. A completed upload answers a re-sent final chunk with 201,
 * so a lost completion response is recovered by re-sending the tail.
 */
export async function uploadResumable(
  api: ApiClient,
  uploadId: string,
  reader: ByteReader,
  opts: UploadOptions = {},
): Promise<UploadDone> {
  const chunk = opts.chunkSize ?? DEFAULT_CHUNK;
  const total = reader.size;
  if (!Number.isSafeInteger(total) || total <= 0) throw new RangeError("file is empty");
  if (!Number.isSafeInteger(chunk) || chunk <= 0) throw new RangeError("bad chunk size");
  const maxStalls = opts.maxStalls ?? 3;

  let offset = await api.uploadOffset(uploadId);
  let stalls = 0;
  for (;;) {
    // Everything staged but the completion was lost: re-send the last chunk to get the result.
    const start = offset >= total ? Math.max(0, total - Math.min(chunk, total)) : offset;
    const length = Math.min(chunk, total - start);
    const bytes = await reader.read(start, length);
    if (bytes.length !== length)
      throw new Error(`short read at ${start}: ${bytes.length}/${length}`);
    try {
      const r = await api.uploadChunk(uploadId, start, total, bytes);
      if (r.done) {
        opts.onProgress?.(total, total);
        return r.result;
      }
      if (r.next <= offset && start === offset) stalls++;
      else stalls = 0;
      offset = r.next;
      opts.onProgress?.(offset, total);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      if (e.status === 409 && e.code === "RangeGap") {
        offset = parseRangeHeader((e as ApiError & { range?: string | null }).range ?? null);
      } else if (e.retryable || e.status === 0) {
        offset = await api.uploadOffset(uploadId);
      } else {
        throw e;
      }
      stalls++;
    }
    if (stalls > maxStalls) throw new ApiError(0, "UploadStalled", { offset }, true);
  }
}
