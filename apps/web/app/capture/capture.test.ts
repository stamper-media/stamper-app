import { readFileSync } from "node:fs";
import {
  type CaptureClaim,
  containsBannedWord,
  decodeRecord,
  hashCaptureClaim,
  KT,
  stamperDomain,
  verifyDeviceSignature,
} from "@stamper/core";
import { inspectJpeg } from "@stamper/minimise";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import { digestBytes } from "../../lib/hashing";
import {
  generateWebKey,
  hexToBytes,
  memoryKeyStore,
  normaliseLowS,
  possessionDigest,
  signDigest,
} from "../../lib/webkey";
import { CAPTURE, WEB_TIER } from "./copy";
import { CaptureError, stampBlob } from "./flow";
import { prepareMedia, UnsupportedMedia, withOrientation1 } from "./prepare";

const domain = stamperDomain(31337, "0x5FbDB2315678afecb367f032d93F642f64180aa3");
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const hx = (b: Uint8Array): Hex => `0x${Buffer.from(b).toString("hex")}`;
const fixture = (f: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${f}`, import.meta.url)));
/** A JPEG with every APPn segment after SOI cut out, like a canvas.toBlob() photo minus JFIF. */
function bareJpeg(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (b[i] === 0xff && (b[i + 1] ?? 0) >= 0xe0 && (b[i + 1] ?? 0) <= 0xef) {
    i += 2 + (((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0));
  }
  parts.push(b.subarray(i));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe("webkey (WebCrypto P-256, KT_P256_RAW)", () => {
  it("generates a non-extractable key whose signatures pass core verifyDeviceSignature", async () => {
    const k = await generateWebKey();
    expect(k.privateKey.extractable).toBe(false);
    for (let i = 0; i < 16; i++) {
      const d = hx(rnd(32));
      const sig = await signDigest(k.privateKey, d);
      expect(BigInt(`0x${sig.slice(66)}`) <= N / 2n).toBe(true);
      expect(
        verifyDeviceSignature({ keyType: KT.P256_RAW, x: k.x, y: k.y }, d, sig, "0x", 0n),
      ).toBe(true);
    }
    const pop = possessionDigest(domain, k);
    const popSig = await signDigest(k.privateKey, pop);
    expect(verifyDeviceSignature({ keyType: 1, x: k.x, y: k.y }, pop, popSig, "0x", 0n)).toBe(true);
  });

  it("folds high-s to low-s and rejects bad lengths", () => {
    const sig = new Uint8Array(64);
    sig[31] = 1;
    sig.set(hexToBytes(`0x${(N - 5n).toString(16).padStart(64, "0")}`), 32);
    expect(BigInt(hx(normaliseLowS(sig).slice(32)))).toBe(5n);
    expect(() => normaliseLowS(new Uint8Array(65))).toThrow();
  });
});

/** In-process stand-in for the custodian that checks what the real one checks for web keys. */
function fakeApi(opts: { quotaAfter?: number } = {}) {
  const calls: string[] = [];
  let key: { x: Hex; y: Hex; keyId: Hex } | null = null;
  let staged: Uint8Array | null = null;
  const challenge = hx(rnd(32));
  let captures = 0;
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const m = init?.method ?? "GET";
    calls.push(`${m} ${url.pathname}`);
    if (url.pathname === "/v1/attest/challenge")
      return json({ challengeId: crypto.randomUUID(), challenge });
    if (m === "POST" && url.pathname === "/v1/devices/web") {
      const b = JSON.parse(String(init?.body));
      const ok = verifyDeviceSignature(
        { keyType: 1, x: b.x, y: b.y },
        possessionDigest(domain, b),
        b.popSig,
        "0x",
        0n,
      );
      if (!ok) return json({ error: "BadSig" }, 400);
      key = b;
      return json({ keyId: b.keyId, level: 0, status: "registering" }, 201);
    }
    if (m === "POST" && url.pathname === "/v1/captures") {
      if (opts.quotaAfter !== undefined && captures >= opts.quotaAfter)
        return json({ error: "QuotaExceeded" }, 429);
      captures++;
      return json({ captureId: "c1", uploadId: "u1", challengeId: "ch1", challenge }, 201);
    }
    if (m === "PUT" && url.pathname === "/v1/uploads/u1") {
      staged = new Uint8Array(await new Response(init?.body as BodyInit).arrayBuffer());
      const d = await digestBytes(staged);
      return json(
        { sha256: d.sha256, pieceCid: "x", pieceCidHex: d.pieceCid, size: String(staged.length) },
        201,
      );
    }
    if (m === "POST" && url.pathname === "/v1/captures/c1/claim") {
      const b = JSON.parse(String(init?.body));
      const w = b.claim;
      const claim: CaptureClaim = {
        ...w,
        contentLength: BigInt(w.contentLength),
        capturedAt: BigInt(w.capturedAt),
        nonce: BigInt(w.nonce),
        deadline: BigInt(w.deadline),
      };
      const stampId = hashCaptureClaim(domain, claim);
      if (
        !key ||
        !verifyDeviceSignature({ keyType: 1, x: key.x, y: key.y }, stampId, b.sig, "0x", 0n)
      )
        return json({ error: "BadSig" }, 422);
      const rec = decodeRecord(new Uint8Array(Buffer.from(b.record, "base64")));
      if (
        rec.platform !== "web" ||
        rec.serverChallenge !== challenge ||
        b.attestation.kind !== "none"
      )
        return json({ error: "RecordMismatch" }, 422);
      if (rec.contentHash !== claim.contentHash || staged?.length !== Number(claim.contentLength))
        return json({ error: "HashMismatch" }, 422);
      return json(
        { stampId, predictedCode: "5VEB-TVRA-F", attempt: 0, status: "registering" },
        202,
      );
    }
    if (url.pathname === "/v1/captures/c1")
      return json({ status: "registered", code: "5VEB-TVRA-F", shareReady: false });
    return json({ error: "NotFound" }, 404);
  }) as typeof fetch;
  return { f, calls, uploaded: () => staged };
}

describe("web capture flow", () => {
  const appInfo = { id: "media.stamper.web", version: "1.0.0", build: "web" };
  const meta = { mediaType: "image/jpeg", dims: { w: 4, h: 3 } };

  it("enrols once, uploads, signs a level-0 claim with attestation none, and polls the code", async () => {
    const api = fakeApi();
    const store = memoryKeyStore();
    const steps: string[] = [];
    const deps = {
      apiUrl: "http://api.test/",
      domain,
      appInfo,
      store,
      hash: async (b: Blob) => digestBytes(new Uint8Array(await b.arrayBuffer())),
      fetch: api.f,
      onStep: (s: string) => steps.push(s),
      sleep: async () => {},
    };
    const r = await stampBlob(
      new Blob([fixture("iphone.jpg")], { type: "image/jpeg" }),
      meta,
      deps,
    );
    expect(r).toMatchObject({ code: "5VEB-TVRA-F", final: true, captureId: "c1" });
    expect(steps.at(-1)).toBe("done");
    expect((await store.get())?.enrolled).toBe(true);
    expect(api.uploaded()).not.toBeNull();
    const up = inspectJpeg(api.uploaded() as Uint8Array);
    expect(up).toMatchObject({
      hasGps: false,
      hasSerial: false,
      hasMakerNote: false,
      orientation: 6,
    });
    await stampBlob(
      new Blob([bareJpeg(fixture("pixel.jpg")) as BlobPart], { type: "image/jpeg" }),
      meta,
      deps,
    );
    expect(inspectJpeg(api.uploaded() as Uint8Array).orientation).toBe(1);
    expect(api.calls.filter((c) => c === "POST /v1/devices/web")).toHaveLength(1);
  });

  it("surfaces the quota as a typed error and refuses non-media files", async () => {
    const api = fakeApi({ quotaAfter: 0 });
    const deps = {
      apiUrl: "http://api.test",
      domain,
      appInfo,
      store: memoryKeyStore(),
      hash: async (b: Blob) => digestBytes(new Uint8Array(await b.arrayBuffer())),
      fetch: api.f,
      pollForMs: 0,
    };
    await expect(
      stampBlob(new Blob([fixture("pixel.jpg")], { type: "image/jpeg" }), meta, deps),
    ).rejects.toMatchObject({
      code: "QuotaExceeded",
      status: 429,
    });
    await expect(
      stampBlob(new Blob([rnd(10)]), { ...meta, mediaType: "text/plain" }, deps),
    ).rejects.toMatchObject({ code: "UnsupportedType" });
    await expect(
      stampBlob(new Blob([rnd(10)], { type: "image/png" }), meta, deps),
    ).rejects.toBeInstanceOf(CaptureError);
  });
});

describe("prepareMedia (metadata minimised before hashing)", () => {
  it("strips GPS, serials and MakerNote from a chosen JPEG and keeps its Orientation", () => {
    const p = prepareMedia(fixture("orient-3.jpg"));
    expect(p.mediaType).toBe("image/jpeg");
    expect(inspectJpeg(p.bytes)).toMatchObject({ hasGps: false, hasSerial: false, orientation: 3 });
    expect(p.sanitised.removed.length).toBeGreaterThan(0);
  });

  it("adds Orientation = 1 to a JPEG with no Exif (a canvas photo)", () => {
    const bare = bareJpeg(fixture("pixel.jpg"));
    expect(inspectJpeg(bare).orientation).toBeUndefined();
    const p = prepareMedia(bare);
    expect(inspectJpeg(p.bytes)).toMatchObject({ orientation: 1, hasGps: false });
    expect(p.sanitised.kept).toContain("Orientation");
    // after a JFIF APP0 the Exif segment goes right behind it
    const jfif = withOrientation1(
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xd9]),
    );
    expect(Array.from(jfif.subarray(0, 10))).toEqual([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xe1,
    ]);
  });

  it("minimises a video and refuses other types", () => {
    expect(prepareMedia(fixture("pixel.mp4")).mediaType).toBe("video/mp4");
    expect(() => prepareMedia(rnd(64))).toThrow(UnsupportedMedia);
  });
});

describe("capture copy", () => {
  it("contains no banned words", () => {
    const all: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") all.push(v);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(CAPTURE);
    walk(WEB_TIER);
    for (const s of all) expect(containsBannedWord(s), s).toBeNull();
    expect(WEB_TIER.headline).toBe("Registered upload — device not attested");
  });
});
