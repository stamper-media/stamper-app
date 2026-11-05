import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "viem";
import type { SecretStore } from "../../lib/keys";
import type { FileAccess } from "../../lib/pipeline";
import type { KV } from "../../lib/queue";

export function memoryKV(map = new Map<string, string>()): KV & { map: Map<string, string> } {
  return {
    map,
    getString: (k) => map.get(k),
    set: (k, v) => {
      map.set(k, v);
    },
    remove: (k) => map.delete(k),
    getAllKeys: () => [...map.keys()],
  };
}

export function memorySecrets(
  init: Record<string, string> = {},
): SecretStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(init));
  return {
    map,
    getItemAsync: async (k) => map.get(k) ?? null,
    setItemAsync: async (k, v) => {
      map.set(k, v);
    },
    deleteItemAsync: async (k) => {
      map.delete(k);
    },
  };
}

export function memFiles(files: Map<string, Uint8Array>): FileAccess {
  const get = (uri: string) => {
    const b = files.get(uri);
    if (!b) throw new Error(`no file ${uri}`);
    return b;
  };
  return {
    readAll: async (uri) => get(uri),
    open: (uri) => {
      const b = get(uri);
      return { size: b.length, read: async (o, l) => b.slice(o, o + l), close: () => undefined };
    },
    sha256: async (uri) => bytesToHex(sha256(get(uri))),
  };
}
