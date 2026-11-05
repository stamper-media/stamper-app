import { createStubAttestation } from "../lib/attestation/stub";
import { prepareJpeg } from "../lib/capture";
import type { CaptureMeta } from "../lib/claim";
import { enrolDevice, getEnrolment } from "../lib/enrol";
import { getOrCreateDeviceKey, nextClaimNonce, setSecretStore } from "../lib/keys";
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

describe("capture pipeline against the fake api (stub attestation)", () => {
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

  async function setup() {
    setSecretStore(memorySecrets());
    const fake = fakeApi(domain);
    const att = createStubAttestation("android");
    const enrolment = await enrolDevice(fake.api, att, { domain, app });
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
    return { fake, deps, enrolment, queue: new CaptureQueue(memoryKV()) };
  }

  it("enrols at L1 with a stub token and remembers the enrolment", async () => {
    const { enrolment, fake } = await setup();
    expect(enrolment.level).toBe(1);
    expect(fake.log).toEqual(["enrol:1"]);
    expect(await getEnrolment()).toEqual(enrolment);
  });

  it("online and offline captures reach claimSent in order, surviving a dropped chunk", async () => {
    const { fake, deps, queue } = await setup();
    await stageCapture(deps, queue, { id: "a", fileUri: "file:///a.jpg", meta, online: true });
    const off = await stageCapture(deps, queue, {
      id: "b",
      fileUri: "file:///b.jpg",
      meta,
      online: false,
    });
    expect(off.state).toBe("signed");
    expect(off.offline).toBe(true);
    fake.failNextChunkAt.offset = 0;
    // small chunks to exercise resume
    const step = createStep(deps);
    const r = await queue.drain(step);
    expect(r.blocked).toBeNull();
    expect(queue.list().map((i) => [i.id, i.state])).toEqual([
      ["a", "claimSent"],
      ["b", "claimSent"],
    ]);
    expect(fake.log.filter((l) => l.startsWith("claim"))).toEqual([
      "claim:online",
      "claim:offline",
    ]);
    expect(queue.get("a")?.signed?.predictedCode).toMatch(/^\w{4}-\w{4}-.$/);
  });

  it("re-signs an online claim whose challenge expired", async () => {
    const { fake, deps, queue } = await setup();
    await stageCapture(deps, queue, { id: "a", fileUri: "file:///a.jpg", meta, online: true });
    const step = createStep(deps);
    let expired = false;
    const r = await queue.drain(async (item) => {
      if (item.state === "uploaded" && !expired) {
        expired = true;
        fake.expireChallenges();
      }
      return step(item);
    });
    expect(r.blocked).toBeNull();
    const a = queue.get("a");
    expect(a?.state).toBe("claimSent");
    expect(a?.attempts).toBe(1);
    expect(a?.signed?.claim.nonce).toBe("2");
  });
});
