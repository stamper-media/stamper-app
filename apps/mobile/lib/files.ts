import { File, Paths } from "expo-file-system";
import type { ByteReader } from "./upload";

export type ClosableReader = ByteReader & { close(): void };

/** Random-access reader over a local file via FileHandle (no full read into memory). */
export function openReader(uri: string): ClosableReader {
  const file = new File(uri);
  if (!file.exists) throw new Error(`file not found: ${uri}`);
  const handle = file.open();
  return {
    size: file.size,
    async read(offset, length) {
      handle.offset = offset;
      return handle.readBytes(length);
    },
    close: () => handle.close(),
  };
}

export async function readAll(uri: string): Promise<Uint8Array> {
  return new File(uri).bytes();
}

/** Writes bytes to the app cache (the queue owns the file until the capture is share-ready). */
export function writeCache(name: string, bytes: Uint8Array): string {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  return file.uri;
}

export function removeFile(uri: string): void {
  const f = new File(uri);
  if (f.exists) f.delete();
}

/** Downloads the marked file next to the capture; returns the local URI. */
export async function downloadToCache(url: string, name: string): Promise<string> {
  const dest = new File(Paths.cache, name);
  if (dest.exists) dest.delete();
  const out = await File.downloadFileAsync(url, dest);
  return out.uri;
}

/**
 * MP4 metadata minimisation without loading the file (DESIGN §7.1): streams through
 * @stamper/minimise into a new cache file. Returns the new URI and the report.
 */
export async function minimiseVideoFile(uri: string, name: string) {
  const { minimiseMp4Stream } = await import("@stamper/minimise");
  const src = openReader(uri);
  const out = new File(Paths.cache, name);
  if (out.exists) out.delete();
  out.create();
  const sink = out.open();
  try {
    const report = await minimiseMp4Stream(src, { write: (chunk) => sink.writeBytes(chunk) });
    return { uri: out.uri, report };
  } finally {
    sink.close();
    src.close();
  }
}
