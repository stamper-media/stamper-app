/**
 * WP-14 browser device key (DESIGN §7.3): a non-extractable WebCrypto P-256 key (KT_P256_RAW,
 * PF.WEB, level 0). The private key never leaves the browser's key store; the CryptoKey object is
 * kept in IndexedDB (structured clone keeps it non-extractable). Clearing site data deletes it: the
 * next stamp enrols a fresh key and earlier stamps stay registered under the old one.
 *
 * Signatures: WebCrypto ECDSA with SHA-256 over the 32-byte digest, i.e. a signature over
 * sha256(digest), which is what the registry checks for KT_P256_RAW. WebCrypto does not normalise
 * s, and the registry rejects high-s, so every signature is folded to low-s here.
 */
import { hashKeyPossession, KT, keyIdFromP256, PF, type stamperDomain } from "@stamper/core";
import type { Address, Hex } from "viem";

export type StamperDomain = ReturnType<typeof stamperDomain>;

export type StoredWebKey = {
  keyId: Hex;
  x: Hex;
  y: Hex;
  privateKey: CryptoKey;
  /** set once POST /v1/devices/web accepted the key (or answered KeyExists). */
  enrolled: boolean;
  createdAt: number;
};

export interface WebKeyStore {
  get(): Promise<StoredWebKey | null>;
  put(k: StoredWebKey): Promise<void>;
  clear(): Promise<void>;
}

const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const ZERO_ADDR: Address = "0x0000000000000000000000000000000000000000";

const toHex = (b: Uint8Array): Hex =>
  `0x${Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("")}`;

export function hexToBytes(h: Hex): Uint8Array {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(h)) throw new Error("expected 0x hex");
  const out = new Uint8Array((h.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(h.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
}

function defaultSubtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("WebCrypto is unavailable (a secure context is required)");
  return s;
}

/** Folds a 64-byte r‖s signature to low-s (s ≤ n/2); returns a new array. */
export function normaliseLowS(sig: Uint8Array): Uint8Array {
  if (sig.length !== 64) throw new Error(`expected a 64-byte P-256 signature, got ${sig.length}`);
  const out = sig.slice();
  const s = BigInt(toHex(sig.slice(32)));
  if (s > P256_N / 2n) out.set(hexToBytes(`0x${(P256_N - s).toString(16).padStart(64, "0")}`), 32);
  return out;
}

/** Generates a fresh non-extractable P-256 signing key. */
export async function generateWebKey(
  subtle: SubtleCrypto = defaultSubtle(),
): Promise<StoredWebKey> {
  const kp = (await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  if (kp.privateKey.extractable) throw new Error("private key must be non-extractable");
  const raw = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
  if (raw.length !== 65 || raw[0] !== 4) throw new Error("unexpected P-256 public key encoding");
  const x = toHex(raw.slice(1, 33));
  const y = toHex(raw.slice(33, 65));
  return {
    keyId: keyIdFromP256(x, y),
    x,
    y,
    privateKey: kp.privateKey,
    enrolled: false,
    createdAt: Date.now(),
  };
}

/** ECDSA-SHA256 over the 32-byte digest, low-s, as 0x r‖s. */
export async function signDigest(
  privateKey: CryptoKey,
  digest: Hex,
  subtle: SubtleCrypto = defaultSubtle(),
): Promise<Hex> {
  const d = hexToBytes(digest);
  if (d.length !== 32) throw new Error("digest must be 32 bytes");
  const sig = new Uint8Array(
    await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, d as BufferSource),
  );
  return toHex(normaliseLowS(sig));
}

/** The KeyPossession digest the registry and the api check for a web key. */
export function possessionDigest(
  domain: StamperDomain,
  k: Pick<StoredWebKey, "keyId" | "x" | "y">,
): Hex {
  return hashKeyPossession(domain, {
    keyId: k.keyId,
    keyType: KT.P256_RAW,
    platform: PF.WEB,
    x: k.x,
    y: k.y,
    addr: ZERO_ADDR,
  });
}

export async function loadOrCreateWebKey(
  store: WebKeyStore,
  subtle: SubtleCrypto = defaultSubtle(),
): Promise<StoredWebKey> {
  const have = await store.get();
  if (have) return have;
  const k = await generateWebKey(subtle);
  await store.put(k);
  return k;
}

export function memoryKeyStore(): WebKeyStore {
  let v: StoredWebKey | null = null;
  return {
    get: async () => v,
    put: async (k) => {
      v = k;
    },
    clear: async () => {
      v = null;
    },
  };
}

const DB_NAME = "stamper-webkey";
const STORE = "keys";
const SLOT = "device";

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error ?? new Error("IndexedDB request failed"));
  });
}

/** IndexedDB-backed store (browser only). */
export function indexedDbKeyStore(name: string = DB_NAME): WebKeyStore {
  const open = (): Promise<IDBDatabase> => {
    if (typeof indexedDB === "undefined")
      return Promise.reject(new Error("IndexedDB is unavailable"));
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    return req(r);
  };
  const run = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open();
    try {
      return await req(f(db.transaction(STORE, mode).objectStore(STORE)));
    } finally {
      db.close();
    }
  };
  return {
    async get() {
      const v = (await run("readonly", (s) => s.get(SLOT))) as StoredWebKey | undefined;
      return v && v.privateKey instanceof CryptoKey ? v : null;
    },
    async put(k) {
      await run("readwrite", (s) => s.put(k, SLOT));
    },
    async clear() {
      await run("readwrite", (s) => s.delete(SLOT));
    },
  };
}
