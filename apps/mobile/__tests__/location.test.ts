import {
  approxLocation,
  decodePrivateRecord,
  decodeRecord,
  exactLocation,
  privateRecordHash,
  recordHash,
} from "@stamper/core";
import { createStubAttestation } from "../lib/attestation/stub";
import { fromBase64, toBase64 } from "../lib/bytes";
import { prepareJpeg } from "../lib/capture";
import { buildClaim, type CaptureMeta } from "../lib/claim";
import { enrolDevice } from "../lib/enrol";
import { getOrCreateDeviceKey, nextClaimNonce, setSecretStore } from "../lib/keys";
import {
  type CaptureLocation,
  getRecordLocationPref,
  type LocationProvider,
  MAX_ACCURACY_M,
  type PlatformFix,
  readCaptureLocation,
  setRecordLocationPref,
} from "../lib/location";
import { createStep, stageCapture } from "../lib/pipeline";
import { CaptureQueue } from "../lib/queue";
import { fakeApi } from "./helpers/fakeApi";
import { readFixture } from "./helpers/fixtures";
import { memFiles, memoryKV, memorySecrets } from "./helpers/memory";

const domain = {
  chainId: 31337 as const,
  registry: "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const,
};
const app = { id: "media.stamper.app", version: "0.1.0", build: "1" };
const p = prepareJpeg(readFixture("pixel.jpg"));
const meta: CaptureMeta = {
  mediaKind: 1,
  mediaType: "image/jpeg",
  dims: p.dims,
  capturedAtMs: Date.now(),
  monotonicNs: "1000",
  platform: "android",
  app,
  facing: "back",
  lensId: "default",
  physicalCameraIds: ["default"],
  sanitised: p.sanitised,
  publicExif: p.publicExif,
};

// Praça da Sé, São Paulo: south and west of 0
const FIX: PlatformFix = {
  coords: { latitude: -23.5505, longitude: -46.6333, accuracy: 8, altitude: 760 },
  timestamp: 1_790_000_000_500,
};

type FakeProvider = LocationProvider & { calls: string[] };
function provider(
  o: { granted?: boolean; fix?: PlatformFix | "never" | Error } = {},
): FakeProvider {
  const calls: string[] = [];
  return {
    source: "fused",
    calls,
    async requestPermission() {
      calls.push("permission");
      return o.granted ?? true;
    },
    currentFix() {
      calls.push("fix");
      if (o.fix === "never") return new Promise<PlatformFix>(() => undefined);
      if (o.fix instanceof Error) return Promise.reject(o.fix);
      return Promise.resolve(o.fix ?? FIX);
    },
  };
}

async function recorded(): Promise<Extract<CaptureLocation, { status: "recorded" }>> {
  const loc = await readCaptureLocation(provider());
  if (loc.status !== "recorded") throw new Error(`expected a fix, got ${loc.status}`);
  return loc;
}

async function setup() {
  setSecretStore(memorySecrets());
  const fake = fakeApi(domain);
  const att = createStubAttestation("android");
  await enrolDevice(fake.api, att, { domain, app });
  const files = new Map([
    ["file:///a.jpg", p.bytes],
    ["file:///b.jpg", p.bytes.slice()],
  ]);
  const deps = {
    api: fake.api,
    att,
    domain,
    keyId: (await getOrCreateDeviceKey()).keyId,
    files: memFiles(files),
    nextNonce: nextClaimNonce,
  };
  return { fake, deps, queue: new CaptureQueue(memoryKV()), step: createStep(deps) };
}

const claimInput = (keyId: `0x${string}`) => ({
  bytes: p.bytes,
  domain,
  keyId,
  nonce: 1n,
  serverChallenge: `0x${"aa".repeat(32)}` as const,
  attestationKind: "stub" as const,
});

describe("record location (opt-in per capture, DESIGN §11.3)", () => {
  it("puts only the cell in the record and commits the exact fix through privateHash", async () => {
    const loc = await recorded();
    const priv = decodePrivateRecord(loc.privateRecord);
    expect(priv.v).toBe(1);
    expect(priv.salt).toMatch(/^0x[0-9a-f]{64}$/);
    expect(priv.location).toEqual(exactLocation({ ...FIX.coords, timestamp: FIX.timestamp }));
    expect(loc.cell).toEqual({ latE2: -2356, lonE2: -4664, source: "fused" });
    expect(loc.cell).toEqual(
      approxLocation(priv.location as NonNullable<typeof priv.location>, "fused"),
    );

    // a fresh CSPRNG salt every capture: the same fix never gives the same privateHash
    const again = await recorded();
    expect(decodePrivateRecord(again.privateRecord).salt).not.toBe(priv.salt);
    expect(privateRecordHash(again.privateRecord)).not.toBe(privateRecordHash(loc.privateRecord));

    const b = await buildClaim({
      ...meta,
      location: loc.cell,
      privateRecord: loc.privateRecord,
      ...claimInput(`0x${"11".repeat(32)}`),
    });
    const rec = decodeRecord(b.record); // core's schema: a location needs privateHash
    expect(rec.location).toEqual(loc.cell);
    expect(rec.privateHash).toBe(privateRecordHash(loc.privateRecord));
    expect(b.claim.recordHash).toBe(recordHash(b.record));
    // the public record holds the cell only, never the fix
    expect(Object.keys(rec.location ?? {}).sort()).toEqual(["latE2", "lonE2", "source"]);
  });

  it("location off: no location in the record and privateHash null", async () => {
    const b = await buildClaim({ ...meta, ...claimInput(`0x${"11".repeat(32)}`) });
    const rec = decodeRecord(b.record);
    expect(Object.hasOwn(rec, "location")).toBe(false);
    expect(rec.privateHash).toBeNull();

    const { queue, deps, fake, step } = await setup();
    await stageCapture(deps, queue, { id: "a", fileUri: "file:///a.jpg", meta, online: true });
    await queue.drain(step);
    const item = queue.get("a");
    expect(item?.state).toBe("claimSent");
    expect(item?.locationStatus).toBeUndefined();
    expect(item?.privateRecord).toBeUndefined();
    expect(fake.claims[0]?.privateRecord).toBeUndefined();
  });

  it("refuses a cell that the private record's fix is not in, before signing", async () => {
    const loc = await recorded();
    const input = { ...meta, ...claimInput(`0x${"11".repeat(32)}`) };
    await expect(
      buildClaim({
        ...input,
        privateRecord: loc.privateRecord,
        location: { ...loc.cell, latE2: loc.cell.latE2 + 1 },
      }),
    ).rejects.toThrow(/exact fix/);
    await expect(buildClaim({ ...input, location: loc.cell })).rejects.toThrow(/exact fix/);
  });

  it("denied permission: no fix is read and the capture registers without location", async () => {
    const prov = provider({ granted: false });
    const loc = await readCaptureLocation(prov);
    expect(loc).toEqual({ status: "denied" });
    expect(prov.calls).toEqual(["permission"]);

    const { queue, deps, fake, step } = await setup();
    await stageCapture(deps, queue, {
      id: "a",
      fileUri: "file:///a.jpg",
      meta,
      online: true,
      location: loc,
    });
    expect((await queue.drain(step)).blocked).toBeNull();
    const item = queue.get("a");
    expect(item?.state).toBe("claimSent");
    expect(item?.locationStatus).toBe("denied");
    expect(item?.privateRecord).toBeUndefined();
    const body = fake.claims[0];
    expect(body?.privateRecord).toBeUndefined();
    const rec = decodeRecord(fromBase64(body?.record ?? ""));
    expect(rec.location).toBeUndefined();
    expect(rec.privateHash).toBeNull();
  });

  it("no fix in time, a vague fix or a failing provider: captured without location", async () => {
    const t0 = Date.now();
    expect(await readCaptureLocation(provider({ fix: "never" }), 30)).toEqual({
      status: "unavailable",
    });
    expect(Date.now() - t0).toBeLessThan(2_000);
    const vague = { ...FIX, coords: { ...FIX.coords, accuracy: MAX_ACCURACY_M + 1 } };
    expect((await readCaptureLocation(provider({ fix: vague }))).status).toBe("unavailable");
    const none = { ...FIX, coords: { ...FIX.coords, accuracy: null } };
    expect((await readCaptureLocation(provider({ fix: none }))).status).toBe("unavailable");
    expect((await readCaptureLocation(provider({ fix: new Error("gps off") }))).status).toBe(
      "unavailable",
    );
  });

  it("the claim carries privateRecord (online and offline) and the queue keeps it", async () => {
    const { queue, deps, fake, step } = await setup();
    const online = await recorded();
    const offline = await recorded();
    await stageCapture(deps, queue, {
      id: "a",
      fileUri: "file:///a.jpg",
      meta,
      online: true,
      location: online,
    });
    const off = await stageCapture(deps, queue, {
      id: "b",
      fileUri: "file:///b.jpg",
      meta,
      online: false,
      location: offline,
    });
    // signed at capture time, before any network: the record already commits to the private record
    expect(off.state).toBe("signed");
    const offRec = decodeRecord(fromBase64(off.signed?.record ?? ""));
    expect(offRec.offline).toBe(true);
    expect(offRec.privateHash).toBe(privateRecordHash(offline.privateRecord));

    expect((await queue.drain(step)).blocked).toBeNull();
    expect(fake.log.filter((l) => l.startsWith("claim"))).toEqual([
      "claim:online",
      "claim:offline",
    ]);
    for (const [id, loc] of [
      ["a", online],
      ["b", offline],
    ] as const) {
      const item = queue.get(id);
      expect(item?.state).toBe("claimSent");
      expect(item?.locationStatus).toBe("recorded");
      expect(item?.meta.location).toEqual(loc.cell);
      // kept with the capture for a later reveal
      expect(item?.privateRecord).toBe(toBase64(loc.privateRecord));
      const body = fake.claims.find((c) => c.record === item?.signed?.record);
      expect(body?.privateRecord).toBe(item?.privateRecord);
      const rec = decodeRecord(fromBase64(body?.record ?? ""));
      expect(rec.location).toEqual(loc.cell);
      expect(rec.privateHash).toBe(privateRecordHash(fromBase64(body?.privateRecord ?? "")));
    }
  });

  it("the toggle is off by default, asks for permission when turned on, and stays off on refusal", async () => {
    setSecretStore(memorySecrets());
    expect(await getRecordLocationPref()).toBe(false);
    const granted = provider();
    expect(await setRecordLocationPref(true, granted)).toEqual({ on: true, denied: false });
    expect(granted.calls).toEqual(["permission"]);
    expect(await getRecordLocationPref()).toBe(true);
    expect(await setRecordLocationPref(false, granted)).toEqual({ on: false, denied: false });
    expect(granted.calls).toEqual(["permission"]); // turning it off asks nothing
    expect(await getRecordLocationPref()).toBe(false);
    expect(await setRecordLocationPref(true, provider({ granted: false }))).toEqual({
      on: false,
      denied: true,
    });
    expect(await getRecordLocationPref()).toBe(false);
  });
});
