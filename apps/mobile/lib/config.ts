import { DEFAULT_ORIGIN, type DomainChainId } from "@stamper/core";
import Constants from "expo-constants";
import type { Address } from "viem";
import { z } from "zod";

export type AttestMode = "real" | "stub";
export type AppConfig = {
  apiUrl: string;
  chainId: DomainChainId;
  registry: Address;
  /** Canonical verify origin (Expo `extra.publicOrigin`, DESIGN §3.6). */
  publicOrigin: string;
  attestMode: AttestMode;
  cloudProjectNumber: string;
  app: { id: string; version: string; build: string };
};

const schema = z.object({
  apiUrl: z.string().url(),
  chainId: z.union([z.literal(314), z.literal(314159), z.literal(31337)]),
  registry: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "registry must be an address"),
  publicOrigin: z.string().url(),
  attestMode: z.enum(["real", "stub"]),
  cloudProjectNumber: z.string().regex(/^\d*$/, "cloud project number must be digits"),
  app: z.object({ id: z.string().min(1), version: z.string().min(1), build: z.string().min(1) }),
});

export type ConfigInput = {
  env: Record<string, string | undefined>;
  extra?: Record<string, unknown> | undefined;
  app?: { id?: string; version?: string; build?: string };
};

/** Validates the EXPO_PUBLIC_* environment; throws a readable error naming the bad field. */
export function parseConfig({ env, extra, app }: ConfigInput): AppConfig {
  const origin = (typeof extra?.publicOrigin === "string" && extra.publicOrigin) || DEFAULT_ORIGIN;
  const raw = {
    apiUrl: (env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, ""),
    chainId: Number(env.EXPO_PUBLIC_CHAIN_ID ?? "314159"),
    registry: env.EXPO_PUBLIC_REGISTRY_ADDRESS ?? "",
    publicOrigin: (env.EXPO_PUBLIC_VERIFY_BASE_URL || origin).replace(/\/+$/, ""),
    attestMode: env.EXPO_PUBLIC_ATTEST_MODE ?? "real",
    cloudProjectNumber:
      env.EXPO_PUBLIC_PLAY_CLOUD_PROJECT_NUMBER ??
      (typeof extra?.cloudProjectNumber === "string" ? extra.cloudProjectNumber : ""),
    app: {
      id: app?.id ?? "media.stamper.app",
      version: app?.version ?? "0.0.0",
      build: app?.build ?? "0",
    },
  };
  const r = schema.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new Error(`Invalid app config at ${i?.path.join(".") ?? "?"}: ${i?.message ?? ""}`);
  }
  return r.data as AppConfig;
}

let cached: AppConfig | undefined;

/** Expo inlines `process.env.EXPO_PUBLIC_*` only for static member access, hence the explicit list. */
export function getConfig(): AppConfig {
  if (cached) return cached;
  const expo = Constants.expoConfig;
  cached = parseConfig({
    env: {
      EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
      EXPO_PUBLIC_CHAIN_ID: process.env.EXPO_PUBLIC_CHAIN_ID,
      EXPO_PUBLIC_REGISTRY_ADDRESS: process.env.EXPO_PUBLIC_REGISTRY_ADDRESS,
      EXPO_PUBLIC_VERIFY_BASE_URL: process.env.EXPO_PUBLIC_VERIFY_BASE_URL,
      EXPO_PUBLIC_ATTEST_MODE: process.env.EXPO_PUBLIC_ATTEST_MODE,
      EXPO_PUBLIC_PLAY_CLOUD_PROJECT_NUMBER: process.env.EXPO_PUBLIC_PLAY_CLOUD_PROJECT_NUMBER,
    },
    extra: expo?.extra,
    app: {
      id: expo?.ios?.bundleIdentifier ?? expo?.android?.package ?? "media.stamper.app",
      version: expo?.version ?? "0.0.0",
      build: String(Constants.nativeBuildVersion ?? "0"),
    },
  });
  return cached;
}
