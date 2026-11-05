/**
 * Opt-in, per-capture location (DESIGN §11.3). Off by default. When "Record location" is on, one
 * fix is read at capture time: the public record carries only the 0.01° cell (about 1 km), and the
 * exact fix goes into the private record, committed by `privateHash` and sealed by the api. A denied
 * permission or a fix that does not arrive in time never blocks the capture: it is taken without
 * location and the UI says so.
 */
import {
  type ApproxLocation,
  approxLocation,
  encodePrivateRecord,
  exactLocation,
  type LocationSource,
} from "@stamper/core";
import { bytesToHex, type Hex } from "viem";
import { getSecretStore } from "./keys";

/** How long a capture waits for the fix (the wait overlaps the shot and the minimisation). */
export const FIX_TIMEOUT_MS = 5_000;
/** A fix vaguer than this could put the capture in a cell it was not taken in. */
export const MAX_ACCURACY_M = 1_000;

/** A platform reading: the subset of expo-location's `LocationObject` used here. */
export type PlatformFix = {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    altitude: number | null;
  };
  timestamp: number;
};

/** The expo-location calls the capture uses; tests inject a fake. */
export interface LocationProvider {
  /** Foreground ("when in use") permission; prompts only while the user has not decided yet. */
  requestPermission(): Promise<boolean>;
  /** One fresh fix. */
  currentFix(): Promise<PlatformFix>;
  /** expo-location reads the platform's fused provider and does not say which radio gave the fix. */
  readonly source: LocationSource;
}

export type LocationStatus = "recorded" | "denied" | "unavailable";

/** What a capture taken with "Record location" on carries. */
export type CaptureLocation =
  | {
      status: "recorded";
      /** Public cell for the record. */
      cell: ApproxLocation;
      /** Canonical DAG-CBOR PrivateRecord {v, salt, location}; its sha256 is the record's privateHash. */
      privateRecord: Uint8Array;
    }
  | { status: "denied" | "unavailable" };

/**
 * 32 bytes from the platform CSPRNG: react-native-get-random-values (SecRandomCopyBytes /
 * SecureRandom, installed first in index.js) in the app, Node's webcrypto under jest. The salt keeps
 * the exact fix from being brute-forced out of privateHash and the public cell.
 */
export function randomSalt(): Hex {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return bytesToHex(b);
}

/** The public cell and the private record for one fix. */
export function locationRecord(
  fix: PlatformFix,
  source: LocationSource,
  salt: Hex = randomSalt(),
): { cell: ApproxLocation; privateRecord: Uint8Array } {
  const exact = exactLocation({ ...fix.coords, timestamp: fix.timestamp });
  return {
    cell: approxLocation(exact, source),
    privateRecord: encodePrivateRecord({ v: 1, salt, location: exact }),
  };
}

function usable(fix: PlatformFix): boolean {
  const { latitude, longitude, accuracy } = fix.coords;
  return (
    Number.isFinite(latitude) &&
    Math.abs(latitude) <= 90 &&
    Number.isFinite(longitude) &&
    Math.abs(longitude) <= 180 &&
    accuracy !== null &&
    Number.isFinite(accuracy) &&
    accuracy <= MAX_ACCURACY_M &&
    Number.isFinite(fix.timestamp)
  );
}

function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/** Reads one fix for a capture. Never throws and never waits longer than `timeoutMs` for the fix. */
export async function readCaptureLocation(
  provider: LocationProvider,
  timeoutMs = FIX_TIMEOUT_MS,
): Promise<CaptureLocation> {
  try {
    if (!(await provider.requestPermission())) return { status: "denied" };
    const fix = await within(provider.currentFix(), timeoutMs);
    if (!fix || !usable(fix)) return { status: "unavailable" };
    return { status: "recorded", ...locationRecord(fix, provider.source) };
  } catch {
    return { status: "unavailable" };
  }
}

let expoProvider: LocationProvider | undefined;

/** expo-location, loaded lazily like the other native modules the jest suite never loads. */
export function expoLocationProvider(): LocationProvider {
  expoProvider ??= {
    source: "fused",
    async requestPermission() {
      const L = await import("expo-location");
      return (await L.requestForegroundPermissionsAsync()).granted;
    },
    async currentFix() {
      const L = await import("expo-location");
      // no Android "turn on improved accuracy" dialog in the middle of a capture
      return L.getCurrentPositionAsync({
        accuracy: L.Accuracy.High,
        mayShowUserSettingsDialog: false,
      });
    },
  };
  return expoProvider;
}

const PREF_SLOT = "stamper.recordLocation.v1";

/** The device's last "Record location" choice; off until the user turns it on. */
export async function getRecordLocationPref(): Promise<boolean> {
  try {
    return (await getSecretStore().getItemAsync(PREF_SLOT)) === "1";
  } catch {
    return false;
  }
}

/**
 * The toggle. Turning it on asks for the permission now rather than in the middle of a capture;
 * a refusal leaves it off. Returns the stored choice.
 */
export async function setRecordLocationPref(
  on: boolean,
  provider: LocationProvider = expoLocationProvider(),
): Promise<{ on: boolean; denied: boolean }> {
  const denied = on && !(await provider.requestPermission().catch(() => false));
  const value = on && !denied;
  await getSecretStore()
    .setItemAsync(PREF_SLOT, value ? "1" : "0")
    .catch(() => undefined);
  return { on: value, denied };
}
