import * as AppIntegrity from "@expo/app-integrity";
import { sha256 } from "@noble/hashes/sha2";
import { type Hex, hexToBytes } from "viem";
import { toBase64Url } from "../bytes";
import {
  AttestationUnavailableError,
  type DeviceAttestation,
  type DevicePlatform,
  type EnrolmentAttestation,
} from "./types";

/** Persistent slot for the App Attest key id (it is not secret; losing it means re-enrolment). */
export interface KeyIdSlot {
  get(): Promise<string | null>;
  set(id: string): Promise<void>;
}

export type AppIntegrityDeps = {
  platform: DevicePlatform;
  cloudProjectNumber: string;
  appAttestKeyId: KeyIdSlot;
  native?: typeof AppIntegrity;
};

const ANDROID_KEY_ALIAS = "stamper-capture-v1";
const hexNo0x = (h: Hex) => h.slice(2).toLowerCase();

/**
 * Real mode: iOS App Attest / Android Play Integrity through @expo/app-integrity (DESIGN §7.2).
 * iOS passes the binding as the challenge string (lower-case hex); Android sends
 * requestHash = base64url(sha256(binding)).
 */
export function createAppIntegrityAttestation(deps: AppIntegrityDeps): DeviceAttestation {
  const native = deps.native ?? AppIntegrity;
  let prepared: Promise<void> | undefined;

  const prepare = (): Promise<void> => {
    prepared ??= (async () => {
      if (deps.platform === "ios") {
        if (!native.isSupported) throw new AttestationUnavailableError("App Attest is unavailable");
        return;
      }
      if (!deps.cloudProjectNumber) {
        throw new AttestationUnavailableError("EXPO_PUBLIC_PLAY_CLOUD_PROJECT_NUMBER is not set");
      }
      await native.prepareIntegrityTokenProviderAsync(deps.cloudProjectNumber);
    })().catch((e: unknown) => {
      prepared = undefined;
      throw e;
    });
    return prepared;
  };

  const requestHash = (binding: Hex) => toBase64Url(sha256(hexToBytes(binding)));

  async function attestKey(binding: Hex): Promise<EnrolmentAttestation> {
    await prepare();
    if (deps.platform === "ios") {
      const keyId = await native.generateKeyAsync();
      const attestationObject = await native.attestKeyAsync(keyId, hexNo0x(binding));
      await deps.appAttestKeyId.set(keyId);
      return { kind: "appattest", keyId, attestationObject };
    }
    const token = await native.requestIntegrityCheckAsync(requestHash(binding));
    // Hardware key attestation chain is collected for the bundle (verification is v1).
    try {
      if (await native.isHardwareAttestationSupportedAsync()) {
        await native.generateHardwareAttestedKeyAsync(ANDROID_KEY_ALIAS, hexNo0x(binding));
        await native.getAttestationCertificateChainAsync(ANDROID_KEY_ALIAS);
      }
    } catch {
      // Optional evidence only; Play Integrity alone decides L1 in the MVP.
    }
    return { kind: "playintegrity", token };
  }

  async function assertCapture(binding: Hex) {
    await prepare();
    if (deps.platform === "ios") {
      const keyId = await deps.appAttestKeyId.get();
      if (!keyId) throw new AttestationUnavailableError("Device is not enrolled with App Attest");
      const assertion = await native.generateAssertionAsync(keyId, hexNo0x(binding));
      return { kind: "appattest" as const, assertion };
    }
    const token = await native.requestIntegrityCheckAsync(requestHash(binding));
    return { kind: "playintegrity" as const, token };
  }

  return {
    kind: deps.platform === "ios" ? "appattest" : "playintegrity",
    platform: deps.platform,
    prepare,
    attestKey,
    assertCapture,
  };
}
