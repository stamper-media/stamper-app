import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { getConfig } from "../config";
import { createAppIntegrityAttestation, type KeyIdSlot } from "./appIntegrity";
import { createStubAttestation } from "./stub";
import type { DeviceAttestation, DevicePlatform } from "./types";

export { createAppIntegrityAttestation } from "./appIntegrity";
export { createStubAttestation, stubToken } from "./stub";
export * from "./types";

const APP_ATTEST_SLOT = "stamper.appAttestKeyId.v1";
const secureSlot: KeyIdSlot = {
  get: () => SecureStore.getItemAsync(APP_ATTEST_SLOT),
  set: (id) => SecureStore.setItemAsync(APP_ATTEST_SLOT, id),
};

export function currentPlatform(): DevicePlatform {
  if (Platform.OS === "ios" || Platform.OS === "android") return Platform.OS;
  throw new Error(`Unsupported platform ${Platform.OS}`);
}

/** real = @expo/app-integrity; stub = `stub:<platform>:<hex>` tokens for simulators / anvil stacks. */
export function createDeviceAttestation(mode: "real" | "stub"): DeviceAttestation {
  const platform = currentPlatform();
  if (mode === "stub") return createStubAttestation(platform);
  return createAppIntegrityAttestation({
    platform,
    cloudProjectNumber: getConfig().cloudProjectNumber,
    appAttestKeyId: secureSlot,
  });
}
