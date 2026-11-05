import { sha256 } from "@noble/hashes/sha2";
import { type PieceCID, type PieceImpl, pieceCidOf } from "@stamper/core";
import { bytesToHex, type Hex } from "viem";

/**
 * PieceCID implementation for photos. 'fr32' (pure JS, always Hermes-safe) until
 * spikes/hermes-piece.md records a device timing that favours 'synapse'.
 */
export const PIECE_IMPL: PieceImpl = "fr32";
export const FILE_CHUNK = 1024 * 1024;

export async function hashPhoto(
  bytes: Uint8Array,
  impl: PieceImpl = PIECE_IMPL,
): Promise<{ sha256: Hex; pieceCid: PieceCID }> {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new TypeError("photo bytes must be a non-empty Uint8Array");
  }
  const pieceCid = await pieceCidOf(bytes, { impl });
  return { sha256: bytesToHex(sha256(bytes)), pieceCid };
}

/** Incremental sha256; react-native-quick-crypto on device, @noble/hashes elsewhere. */
export type StreamHasher = { update(chunk: Uint8Array): void; digest(): Uint8Array };
type QuickCrypto = {
  createHash(alg: "sha256"): {
    update(d: ArrayBuffer): unknown;
    digest(): ArrayBuffer | Uint8Array;
  };
};

export async function createSha256(): Promise<StreamHasher> {
  try {
    const qc = (await import("react-native-quick-crypto")) as unknown as QuickCrypto;
    const h = qc.createHash("sha256");
    return {
      update: (c) => {
        h.update(c.slice().buffer as ArrayBuffer);
      },
      digest: () => new Uint8Array(h.digest()),
    };
  } catch {
    const h = sha256.create();
    return { update: (c) => h.update(c), digest: () => h.digest() };
  }
}

export type ChunkSource = {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
};

/** Streams `src` in 1 MiB reads (video path, DESIGN §7.1). */
export async function sha256Stream(
  src: ChunkSource,
  hasher?: StreamHasher,
  chunk = FILE_CHUNK,
): Promise<Hex> {
  const h = hasher ?? (await createSha256());
  for (let off = 0; off < src.size; off += chunk) {
    const len = Math.min(chunk, src.size - off);
    const bytes = await src.read(off, len);
    if (bytes.length !== len) throw new Error(`short read at ${off}`);
    h.update(bytes);
  }
  return bytesToHex(h.digest());
}

/** sha256 of a local file URI (expo-file-system FileHandle, 1 MiB reads). */
export async function sha256File(uri: string): Promise<Hex> {
  const { openReader } = await import("./files");
  const r = openReader(uri);
  try {
    return await sha256Stream(r);
  } finally {
    r.close();
  }
}
