import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, type Hex, hexToBytes, isHex } from "viem";
import type { DeviceAttestation, DevicePlatform } from "./types";

/** `stub:<ios|android>:<hex sha256(binding)>`, lower-case hex without 0x (plan §4.2). */
export function stubToken(platform: DevicePlatform, binding: Hex): string {
  if (!isHex(binding) || binding.length !== 66) throw new TypeError("binding must be bytes32 hex");
  return `stub:${platform}:${bytesToHex(sha256(hexToBytes(binding))).slice(2)}`;
}

/** Simulators, emulators and the anvil stack (servers in ATTEST_MODE=strict reject it). */
export function createStubAttestation(platform: DevicePlatform): DeviceAttestation {
  return {
    kind: "stub",
    platform,
    prepare: async () => undefined,
    attestKey: async (binding) => ({ kind: "stub", token: stubToken(platform, binding) }),
    assertCapture: async (binding) => ({ kind: "stub", token: stubToken(platform, binding) }),
  };
}
