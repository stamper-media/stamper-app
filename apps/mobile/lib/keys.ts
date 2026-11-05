import { keyIdFromAddress } from "@stamper/core";
import * as SecureStore from "expo-secure-store";
import type { Address, Hex, TypedData, TypedDataDomain } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/** The subset of expo-secure-store the key module uses; tests inject an in-memory one. */
export interface SecretStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const expoStore: SecretStore = {
  getItemAsync: (k) => SecureStore.getItemAsync(k, OPTS),
  setItemAsync: (k, v) => SecureStore.setItemAsync(k, v, OPTS),
  deleteItemAsync: (k) => SecureStore.deleteItemAsync(k, OPTS),
};

const KEY_SLOT = "stamper.deviceKey.v1";
const NONCE_SLOT = "stamper.claimNonce.v1";
const PK_RE = /^0x[0-9a-fA-F]{64}$/;

let store: SecretStore = expoStore;
let lock: Promise<unknown> = Promise.resolve();

export function setSecretStore(s: SecretStore): void {
  store = s;
}

/** Serialises read-modify-write sequences on the secure store. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => undefined);
  return run;
}

async function loadPrivateKey(): Promise<Hex> {
  return serial(async () => {
    const existing = await store.getItemAsync(KEY_SLOT);
    if (existing) {
      if (!PK_RE.test(existing)) throw new Error("Stored device key is corrupt");
      return existing as Hex;
    }
    const pk = generatePrivateKey();
    await store.setItemAsync(KEY_SLOT, pk);
    return pk;
  });
}

/** MVP device key: software secp256k1 (DESIGN §7.2); keyId = bytes32(uint160(addr)). */
export async function getOrCreateDeviceKey(): Promise<{ address: Address; keyId: Hex }> {
  const account = privateKeyToAccount(await loadPrivateKey());
  return { address: account.address, keyId: keyIdFromAddress(account.address) };
}

export async function signTypedDataWithDeviceKey(
  domain: TypedDataDomain,
  types: TypedData,
  primaryType: string,
  message: Record<string, unknown>,
): Promise<Hex> {
  const account = privateKeyToAccount(await loadPrivateKey());
  // viem's generic typing cannot follow a runtime primaryType; core's *Types objects are TypedData.
  return account.signTypedData({ domain, types, primaryType, message } as Parameters<
    typeof account.signTypedData
  >[0]);
}

/** Per-key monotonic claim nonce (local counter; DESIGN §3.3). Returns the next unused value. */
export function nextClaimNonce(): Promise<bigint> {
  return serial(async () => {
    const raw = await store.getItemAsync(NONCE_SLOT);
    const current = raw && /^\d+$/.test(raw) ? BigInt(raw) : 0n;
    const next = current + 1n;
    await store.setItemAsync(NONCE_SLOT, next.toString());
    return next;
  });
}

/** Forgets the device key (settings → reset). A new key needs a new enrolment. */
export function resetDeviceKey(): Promise<void> {
  return serial(async () => {
    await store.deleteItemAsync(KEY_SLOT);
    await store.deleteItemAsync(NONCE_SLOT);
  });
}

export function getSecretStore(): SecretStore {
  return store;
}
