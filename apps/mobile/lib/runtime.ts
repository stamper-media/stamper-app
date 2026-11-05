import * as Network from "expo-network";
import { type ApiClient, createApiClient } from "./api";
import { createDeviceAttestation, type DeviceAttestation } from "./attestation";
import { type AppConfig, getConfig } from "./config";
import { openReader, readAll } from "./files";
import { sha256File } from "./hash";
import { getOrCreateDeviceKey, nextClaimNonce } from "./keys";
import { createStep, type PipelineDeps } from "./pipeline";
import { type CaptureQueue, openPersistentQueue } from "./queue";

export type Runtime = {
  cfg: AppConfig;
  api: ApiClient;
  att: DeviceAttestation;
  queue: CaptureQueue;
  deps: PipelineDeps;
  isOnline(): Promise<boolean>;
  /** Drains the offline queue (single flight). */
  drain(): Promise<void>;
};

let runtime: Promise<Runtime> | undefined;
const listeners = new Set<() => void>();

export function onQueueChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function notifyQueueChange(): void {
  for (const fn of listeners) fn();
}

async function isOnline(): Promise<boolean> {
  try {
    const s = await Network.getNetworkStateAsync();
    return !!s.isConnected && s.isInternetReachable !== false;
  } catch {
    return false;
  }
}

async function create(): Promise<Runtime> {
  const cfg = getConfig();
  const api = createApiClient(cfg.apiUrl);
  const att = createDeviceAttestation(cfg.attestMode);
  const queue = await openPersistentQueue();
  const { keyId } = await getOrCreateDeviceKey();
  const deps: PipelineDeps = {
    api,
    att,
    domain: { chainId: cfg.chainId, registry: cfg.registry },
    keyId,
    files: { readAll, open: openReader, sha256: sha256File },
    nextNonce: nextClaimNonce,
  };
  const step = createStep(deps);
  let inflight: Promise<void> | undefined;
  const drain = () => {
    inflight ??= (async () => {
      try {
        if (await isOnline())
          await queue.drain(async (item) => {
            const next = await step(item);
            notifyQueueChange();
            return next;
          });
      } finally {
        inflight = undefined;
        notifyQueueChange();
      }
    })();
    return inflight;
  };
  att.prepare().catch(() => undefined);
  return { cfg, api, att, queue, deps, isOnline, drain };
}

export function getRuntime(): Promise<Runtime> {
  runtime ??= create().catch((e: unknown) => {
    runtime = undefined;
    throw e;
  });
  return runtime;
}
