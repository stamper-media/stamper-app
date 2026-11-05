import { sha256 } from "@noble/hashes/sha2";
import {
  decodePrivateRecord,
  decodeRecord,
  fixInCell,
  hashCaptureClaim,
  hashKeyPossession,
  PF,
  pieceCidHex,
  pieceCidOf,
  pieceCidString,
  privateRecordHash,
  stamperDomain,
  verifyDeviceSignature,
  ZERO_BYTES32,
} from "@stamper/core";
import { bytesToHex, concatBytes, type Hex, hexToBytes } from "viem";
import { type ApiClient, ApiError, type ClaimBody } from "../../lib/api";
import { stubToken } from "../../lib/attestation/stub";
import { fromBase64 } from "../../lib/bytes";
import { claimFromWire } from "../../lib/claim";

const sha = (...parts: Hex[]) => bytesToHex(sha256(concatBytes(parts.map((p) => hexToBytes(p)))));
const rndHex = () => bytesToHex(crypto.getRandomValues(new Uint8Array(32)));

/** In-memory api that applies the WP-07 §7.4 checks the device side must satisfy. */
export function fakeApi(domain: { chainId: 31337; registry: Hex }) {
  const d = stamperDomain(domain.chainId, domain.registry);
  const challenges = new Map<string, Hex>();
  const keys = new Map<string, { addr: Hex; platform: "ios" | "android" }>();
  const uploads = new Map<
    string,
    { buf: number[]; done?: { sha256: Hex; pieceCid: string; pieceCidHex: Hex; size: string } }
  >();
  const captures = new Map<string, { uploadId: string; challengeId: string; mediaKind: 1 | 2 }>();
  const usedNonces = new Set<string>();
  let n = 0;
  const id = (p: string) => `${p}-${++n}`;
  const log: string[] = [];
  const failNextChunkAt = { offset: -1 };
  /** Every accepted claim body, in order. */
  const claims: ClaimBody[] = [];

  const api: ApiClient = {
    baseUrl: "http://fake",
    async challenge() {
      const challengeId = id("ch");
      const challenge = rndHex();
      challenges.set(challengeId, challenge);
      return { challengeId, challenge, expiresAt: new Date().toISOString() };
    },
    async enrol(b) {
      const ch = challenges.get(b.attestation.challengeId);
      if (!ch) throw new ApiError(400, "ChallengeInvalid");
      challenges.delete(b.attestation.challengeId);
      const pop = hashKeyPossession(d, {
        keyId: b.keyId,
        keyType: 0,
        platform: b.platform === "ios" ? PF.IOS : PF.ANDROID,
        x: ZERO_BYTES32,
        y: ZERO_BYTES32,
        addr: b.addr,
      });
      if (!verifyDeviceSignature({ keyType: 0, addr: b.addr }, pop, b.popSig, "0x", 0n)) {
        throw new ApiError(400, "BadPop");
      }
      const ok = b.attestation.token === stubToken(b.platform, sha(b.addr, ch));
      keys.set(b.keyId.toLowerCase(), { addr: b.addr, platform: b.platform });
      log.push(`enrol:${ok ? 1 : 0}`);
      return { keyId: b.keyId, level: ok ? 1 : 0, txHash: rndHex(), status: "registering" };
    },
    async createCapture(b) {
      if (!keys.has(b.keyId.toLowerCase())) throw new ApiError(404, "UnknownKey");
      const c = await api.challenge();
      const captureId = id("cap");
      const uploadId = id("up");
      uploads.set(uploadId, { buf: [] });
      captures.set(captureId, { uploadId, challengeId: c.challengeId, mediaKind: b.mediaKind });
      log.push("capture");
      return { captureId, uploadId, challengeId: c.challengeId, challenge: c.challenge };
    },
    async uploadOffset(uploadId) {
      const u = uploads.get(uploadId);
      if (!u) throw new ApiError(404, "NotFound");
      return u.buf.length;
    },
    async uploadChunk(uploadId, start, total, body) {
      const u = uploads.get(uploadId);
      if (!u) throw new ApiError(404, "NotFound");
      if (u.done && start + body.length === total) return { done: true, result: u.done };
      if (start !== u.buf.length) {
        throw Object.assign(new ApiError(409, "RangeGap"), {
          range: u.buf.length ? `bytes=0-${u.buf.length - 1}` : null,
        });
      }
      if (failNextChunkAt.offset === start) {
        failNextChunkAt.offset = -1;
        // half the chunk lands, then the connection drops
        u.buf.push(...body.subarray(0, Math.floor(body.length / 2)));
        throw new ApiError(0, "NetworkError", undefined, true);
      }
      u.buf.push(...body);
      log.push(`chunk:${start}`);
      if (u.buf.length < total) return { done: false, next: u.buf.length };
      const bytes = Uint8Array.from(u.buf);
      const cid = await pieceCidOf(bytes, { impl: "synapse" });
      u.done = {
        sha256: bytesToHex(sha256(bytes)),
        pieceCid: pieceCidString(cid),
        pieceCidHex: pieceCidHex(cid),
        size: String(bytes.length),
      };
      return { done: true, result: u.done };
    },
    async submitClaim(captureId, b) {
      const cap = captures.get(captureId);
      if (!cap) throw new ApiError(404, "NotFound");
      const up = uploads.get(cap.uploadId)?.done;
      if (!up) throw new ApiError(409, "NotUploaded");
      const claim = claimFromWire(b.claim);
      if (claim.contentHash.toLowerCase() !== up.sha256.toLowerCase())
        throw new ApiError(422, "HashMismatch");
      if (claim.pieceCid.toLowerCase() !== up.pieceCidHex.toLowerCase())
        throw new ApiError(422, "HashMismatch");
      const key = keys.get(claim.keyId.toLowerCase());
      if (!key) throw new ApiError(404, "UnknownKey");
      const stampId = hashCaptureClaim(d, claim);
      if (!verifyDeviceSignature({ keyType: 0, addr: key.addr }, stampId, b.sig, "0x", 0n)) {
        throw new ApiError(422, "BadSig");
      }
      const nonceKey = `${claim.keyId}:${claim.nonce}`;
      if (usedNonces.has(nonceKey)) throw new ApiError(422, "NonceUsed");
      const ch = challenges.get(b.attestation.challengeId);
      if (!ch || b.attestation.challengeId !== cap.challengeId)
        throw new ApiError(422, "ChallengeInvalid");
      challenges.delete(b.attestation.challengeId);
      if (b.attestation.token !== stubToken(key.platform, sha(stampId, ch))) {
        throw new ApiError(422, "AttestationInvalid");
      }
      const recBytes = fromBase64(b.record);
      if (sha(bytesToHex(recBytes)) !== claim.recordHash) throw new ApiError(422, "RecordHash");
      const rec = decodeRecord(recBytes);
      const offline = (claim.flags & 2) !== 0;
      if (!offline && rec.serverChallenge !== ch) throw new ApiError(422, "RecordMismatch");
      // services/api validate-claim step 10
      if (b.privateRecord) {
        const priv = fromBase64(b.privateRecord);
        if (!rec.privateHash || privateRecordHash(priv) !== rec.privateHash)
          throw new ApiError(422, "PrivateRecordInvalid", "does not hash to record.privateHash");
        const fix = decodePrivateRecord(priv).location;
        if (rec.location && (!fix || !fixInCell(fix, rec.location)))
          throw new ApiError(422, "PrivateRecordInvalid", "exact fix is not inside the cell");
      } else if (rec.location) {
        throw new ApiError(
          422,
          "PrivateRecordInvalid",
          "a public location needs the private record",
        );
      }
      usedNonces.add(nonceKey);
      claims.push(b);
      log.push(`claim:${offline ? "offline" : "online"}`);
      return { stampId, predictedCode: "", attempt: 0, status: "registering" };
    },
    async captureStatus() {
      throw new ApiError(501, "NotImplemented");
    },
  };
  return { api, log, claims, failNextChunkAt, expireChallenges: () => challenges.clear() };
}
