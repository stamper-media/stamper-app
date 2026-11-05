import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, hexToBytes } from "viem";
import { createApiClient, parseRangeHeader } from "../lib/api";
import { createAppIntegrityAttestation } from "../lib/attestation/appIntegrity";
import { createStubAttestation, stubToken } from "../lib/attestation/stub";
import { fromBase64, toBase64, toBase64Url } from "../lib/bytes";
import { parseConfig } from "../lib/config";

const binding = `0x${"5a".repeat(32)}` as const;

describe("attestation", () => {
  it("stub tokens follow plan §4.2", async () => {
    const expected = `stub:ios:${bytesToHex(sha256(hexToBytes(binding))).slice(2)}`;
    expect(stubToken("ios", binding)).toBe(expected);
    const att = createStubAttestation("ios");
    expect(await att.attestKey(binding)).toEqual({ kind: "stub", token: expected });
    expect(await att.assertCapture(binding)).toEqual({ kind: "stub", token: expected });
    expect(() => stubToken("ios", "0x12")).toThrow(TypeError);
  });

  it("real mode on iOS passes the binding as lower-case hex and keeps the App Attest key id", async () => {
    let saved: string | null = null;
    const calls: string[] = [];
    const native = {
      isSupported: true,
      generateKeyAsync: async () => "kid",
      attestKeyAsync: async (k: string, c: string) => {
        calls.push(`attest:${k}:${c}`);
        return "b64att";
      },
      generateAssertionAsync: async (k: string, c: string) => {
        calls.push(`assert:${k}:${c}`);
        return "b64assert";
      },
    };
    const att = createAppIntegrityAttestation({
      platform: "ios",
      cloudProjectNumber: "",
      appAttestKeyId: {
        get: async () => saved,
        set: async (v) => {
          saved = v;
        },
      },
      native: native as never,
    });
    expect(await att.attestKey(binding)).toEqual({
      kind: "appattest",
      keyId: "kid",
      attestationObject: "b64att",
    });
    expect(await att.assertCapture(binding)).toEqual({ kind: "appattest", assertion: "b64assert" });
    expect(calls).toEqual([`attest:kid:${"5a".repeat(32)}`, `assert:kid:${"5a".repeat(32)}`]);
  });

  it("real mode on Android sends requestHash = base64url(sha256(binding))", async () => {
    const hashes: string[] = [];
    const native = {
      prepareIntegrityTokenProviderAsync: async () => undefined,
      requestIntegrityCheckAsync: async (h: string) => {
        hashes.push(h);
        return "play-token";
      },
      isHardwareAttestationSupportedAsync: async () => false,
    };
    const att = createAppIntegrityAttestation({
      platform: "android",
      cloudProjectNumber: "123",
      appAttestKeyId: { get: async () => null, set: async () => undefined },
      native: native as never,
    });
    expect(await att.attestKey(binding)).toEqual({ kind: "playintegrity", token: "play-token" });
    expect(hashes[0]).toBe(toBase64Url(sha256(hexToBytes(binding))));
    const noProject = createAppIntegrityAttestation({
      platform: "android",
      cloudProjectNumber: "",
      appAttestKeyId: { get: async () => null, set: async () => undefined },
      native: native as never,
    });
    await expect(noProject.attestKey(binding)).rejects.toThrow(/CLOUD_PROJECT/);
  });
});

describe("api client and helpers", () => {
  it("base64 round-trips", () => {
    for (const n of [0, 1, 2, 3, 4, 255]) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 37) & 0xff);
      expect(fromBase64(toBase64(b))).toEqual(b);
      expect(fromBase64(toBase64Url(b))).toEqual(b);
    }
    expect(toBase64(new Uint8Array([1, 2, 3, 4]))).toBe("AQIDBA==");
  });

  it("parses Range headers", () => {
    expect(parseRangeHeader(null)).toBe(0);
    expect(parseRangeHeader("bytes=0-99")).toBe(100);
    expect(() => parseRangeHeader("bytes=5-9")).toThrow();
  });

  it("retries 429 with Retry-After and maps error bodies", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const api = createApiClient("http://x/", {
      sleep: async (ms) => void sleeps.push(ms),
      fetch: async () => {
        calls++;
        if (calls === 1)
          return new Response(null, { status: 429, headers: { "retry-after": "2" } });
        return new Response(JSON.stringify({ error: "BadSig" }), { status: 422 });
      },
    });
    await expect(api.captureStatus("c")).rejects.toMatchObject({
      status: 422,
      code: "BadSig",
      retryable: false,
    });
    expect(sleeps).toEqual([2000]);
  });

  it("validates config", () => {
    const c = parseConfig({
      env: {
        EXPO_PUBLIC_API_URL: "http://127.0.0.1:4000/",
        EXPO_PUBLIC_CHAIN_ID: "31337",
        EXPO_PUBLIC_REGISTRY_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        EXPO_PUBLIC_ATTEST_MODE: "stub",
      },
      extra: { publicOrigin: "https://example.test" },
    });
    expect(c.apiUrl).toBe("http://127.0.0.1:4000");
    expect(c.publicOrigin).toBe("https://example.test");
    expect(() => parseConfig({ env: { EXPO_PUBLIC_API_URL: "nope" } })).toThrow(/apiUrl/);
  });
});
