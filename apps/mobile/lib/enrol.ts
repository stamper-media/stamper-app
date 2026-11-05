import { sha256 } from "@noble/hashes/sha2";
import { keyPossessionTypes, PF, stamperDomain, ZERO_BYTES32 } from "@stamper/core";
import { bytesToHex, concatBytes, type Hex, hexToBytes } from "viem";
import type { ApiClient } from "./api";
import {
  AttestationUnavailableError,
  type DeviceAttestation,
  type EnrolmentAttestation,
} from "./attestation/types";
import type { StampDomain } from "./claim";
import { getOrCreateDeviceKey, getSecretStore, signTypedDataWithDeviceKey } from "./keys";

export type Enrolment = { keyId: Hex; level: number; txHash: Hex };
const SLOT = "stamper.enrolment.v1";

export function bindingOf(a: Hex, challenge: Hex): Hex {
  return bytesToHex(sha256(concatBytes([hexToBytes(a), hexToBytes(challenge)])));
}

export async function getEnrolment(): Promise<Enrolment | null> {
  const raw = await getSecretStore().getItemAsync(SLOT);
  if (!raw) return null;
  try {
    const e = JSON.parse(raw) as Enrolment;
    return typeof e.keyId === "string" && typeof e.level === "number" ? e : null;
  } catch {
    return null;
  }
}

export type EnrolOptions = {
  domain: StampDomain;
  app: { id: string; version: string; build: string };
};

/**
 * DESIGN §7.2: key possession signature + platform attestation over sha256(addr ‖ challenge).
 * When the platform cannot attest, the key is enrolled at L0 (attestation kind "none").
 */
export async function enrolDevice(
  api: ApiClient,
  att: DeviceAttestation,
  opts?: EnrolOptions,
): Promise<Enrolment> {
  const o = opts ?? (await defaultEnrolOptions());
  const { address, keyId } = await getOrCreateDeviceKey();
  const popSig = await signTypedDataWithDeviceKey(
    stamperDomain(o.domain.chainId, o.domain.registry),
    keyPossessionTypes,
    "KeyPossession",
    {
      keyId,
      keyType: 0,
      platform: att.platform === "ios" ? PF.IOS : PF.ANDROID,
      x: ZERO_BYTES32,
      y: ZERO_BYTES32,
      addr: address,
    },
  );
  const ch = await api.challenge(keyId);
  let attestation: EnrolmentAttestation;
  try {
    attestation = await att.attestKey(bindingOf(address, ch.challenge));
  } catch (e) {
    if (!(e instanceof AttestationUnavailableError)) throw e;
    attestation = { kind: "none" };
  }
  const res = await api.enrol({
    addr: address,
    keyId,
    platform: att.platform,
    keyType: 0,
    popSig,
    attestation: { ...attestation, challengeId: ch.challengeId },
    appInfo: o.app,
  });
  const out: Enrolment = { keyId: res.keyId, level: res.level, txHash: res.txHash };
  await getSecretStore().setItemAsync(SLOT, JSON.stringify(out));
  return out;
}

async function defaultEnrolOptions(): Promise<EnrolOptions> {
  const { getConfig } = await import("./config");
  const c = getConfig();
  return { domain: { chainId: c.chainId, registry: c.registry }, app: c.app };
}
