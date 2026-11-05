import { sha256 } from "@noble/hashes/sha2";
import {
  type CaptureClaim,
  decodeRecord,
  FLAG,
  pieceCidHex,
  pieceCidOf,
  recordHash,
  verifyDeviceSignature,
} from "@stamper/core";
import { inspectJpeg } from "@stamper/minimise";
import { bytesToHex, type Hex } from "viem";
import { prepareJpeg } from "../lib/capture";
import {
  assembleClaim,
  buildClaim,
  type CaptureMeta,
  claimFromWire,
  claimToWire,
  signClaim,
} from "../lib/claim";
import { getOrCreateDeviceKey, setSecretStore } from "../lib/keys";
import { claimVectors, readFixture } from "./helpers/fixtures";
import { memorySecrets } from "./helpers/memory";

const v = claimVectors.claims.find((c) => c.name === "secp256k1-online");
if (!v) throw new Error("vector missing");
const domain = {
  chainId: claimVectors.domain.chainId as 31337,
  registry: claimVectors.domain.verifyingContract,
};
const vectorClaim: CaptureClaim = {
  contentHash: v.claim.contentHash as Hex,
  pieceCid: v.claim.pieceCid as Hex,
  contentLength: BigInt(v.claim.contentLength as string),
  mediaKind: v.claim.mediaKind as 1,
  capturedAt: BigInt(v.claim.capturedAt as string),
  recordHash: v.claim.recordHash as Hex,
  keyId: v.claim.keyId as Hex,
  nonce: BigInt(v.claim.nonce as string),
  flags: v.claim.flags as number,
  deadline: BigInt(v.claim.deadline as string),
};

const meta = (dims: { w: number; h: number }, p: ReturnType<typeof prepareJpeg>): CaptureMeta => ({
  mediaKind: 1,
  mediaType: "image/jpeg",
  dims,
  capturedAtMs: 1_790_000_000_001,
  monotonicNs: "123456789",
  platform: "android",
  app: { id: "media.stamper.app", version: "0.1.0", build: "1" },
  facing: "back",
  lensId: "default",
  physicalCameraIds: ["default"],
  sanitised: p.sanitised,
  publicExif: p.publicExif,
});

describe("claim vectors (@stamper/core test vectors)", () => {
  it("reproduces stampId and the predicted code", () => {
    const a = assembleClaim(domain, vectorClaim);
    expect(a.stampId).toBe(v.digest);
    expect(a.predictedCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-Z*~$=]$/);
  });

  it("signs with the device key exactly like the vector", async () => {
    setSecretStore(memorySecrets({ "stamper.deviceKey.v1": v.privateKey }));
    const { address, keyId } = await getOrCreateDeviceKey();
    expect(address).toBe(v.keyInfo.addr);
    expect(keyId).toBe(vectorClaim.keyId);
    const sig = await signClaim(domain, vectorClaim);
    expect(sig).toBe(v.sig);
    expect(verifyDeviceSignature({ keyType: 0, addr: address }, v.digest, sig, "0x", 0n)).toBe(
      true,
    );
  });

  it("wire encoding round-trips", () => {
    const w = claimToWire(vectorClaim);
    expect(w.contentLength).toBe("1");
    expect(claimFromWire(w)).toEqual(vectorClaim);
  });
});

describe("minimiser output is what gets hashed", () => {
  const raw = readFixture("iphone.jpg");

  it("drops GPS, keeps Orientation, and hashes the minimised bytes", async () => {
    expect(inspectJpeg(raw).hasGps).toBe(true);
    const p = prepareJpeg(raw);
    const after = inspectJpeg(p.bytes);
    expect(after.hasGps).toBe(false);
    expect(after.hasSerial).toBe(false);
    expect(after.orientation).toBe(inspectJpeg(raw).orientation);
    expect(p.sanitised.kept).toContain("Orientation");
    expect(p.sanitised.removed).toContain("GPSInfo");

    const b = await buildClaim({
      ...meta(p.dims, p),
      bytes: p.bytes,
      domain,
      keyId: vectorClaim.keyId,
      nonce: 7n,
      serverChallenge: `0x${"aa".repeat(32)}`,
      attestationKind: "stub",
    });
    expect(b.claim.contentHash).toBe(bytesToHex(sha256(p.bytes)));
    expect(b.claim.contentHash).not.toBe(bytesToHex(sha256(raw)));
    expect(b.claim.contentLength).toBe(BigInt(p.bytes.length));
    // fr32 (device default) and synapse PieceCIDs agree
    expect(b.claim.pieceCid).toBe(pieceCidHex(await pieceCidOf(p.bytes, { impl: "synapse" })));
    expect(b.recordHash).toBe(recordHash(b.record));
    expect(b.claim.recordHash).toBe(b.recordHash);
    expect(b.claim.flags).toBe(0);
    expect(b.claim.deadline).toBe(1_790_000_000n + 3600n);
    const rec = decodeRecord(b.record);
    expect(rec.contentHash).toBe(b.claim.contentHash);
    expect(rec.serverChallenge).toBe(`0x${"aa".repeat(32)}`);
    expect(rec.attestation.kind).toBe("none");
    expect(rec.sanitised.kept.join()).not.toMatch(/GPS|Serial|Owner/);
    expect(Object.keys(rec.publicExif).sort()).toEqual([
      "exposure",
      "focalLength",
      "iso",
      "make",
      "model",
    ]);
  });

  it("offline claims carry FLAG.OFFLINE and the 72 h deadline", async () => {
    const p = prepareJpeg(raw);
    const b = await buildClaim({
      ...meta(p.dims, p),
      bytes: p.bytes,
      domain,
      keyId: vectorClaim.keyId,
      nonce: 8n,
      serverChallenge: null,
      attestationKind: "none",
    });
    expect(b.claim.flags & FLAG.OFFLINE).toBe(FLAG.OFFLINE);
    expect(b.claim.deadline).toBe(1_790_000_000n + 72n * 3600n);
    expect(decodeRecord(b.record).offline).toBe(true);
  });

  it("video claims use the server PieceCID and flag it", async () => {
    const p = prepareJpeg(raw);
    const b = await buildClaim({
      ...meta(p.dims, p),
      mediaKind: 2,
      mediaType: "video/mp4",
      domain,
      keyId: vectorClaim.keyId,
      nonce: 9n,
      serverChallenge: `0x${"bb".repeat(32)}`,
      attestationKind: "stub",
      serverComputed: {
        contentHash: vectorClaim.contentHash,
        pieceCidHex: vectorClaim.pieceCid,
        contentLength: 1,
      },
    });
    expect(b.claim.flags & FLAG.PIECECID_SERVER_COMPUTED).toBeTruthy();
    expect(b.claim.pieceCid).toBe(vectorClaim.pieceCid);
  });
});
