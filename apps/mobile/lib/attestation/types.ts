import type { Hex } from "viem";

export type AttestationKind = "appattest" | "playintegrity" | "stub" | "none";
export type DevicePlatform = "ios" | "android";

/** Wire shape of `attestation` in POST /v1/devices/{platform} (without challengeId). */
export type EnrolmentAttestation = {
  kind: AttestationKind;
  keyId?: string;
  attestationObject?: string;
  token?: string;
};

/** Wire shape of `attestation` in POST /v1/captures/{id}/claim (without challengeId). */
export type CaptureAttestation = { kind: AttestationKind; assertion?: string; token?: string };

/**
 * Platform attestation behind one interface (DESIGN §7.1). `binding` is the 32-byte value the
 * server recomputes: sha256(addr ‖ challenge) at enrolment, sha256(stampId ‖ challenge) per capture.
 */
export interface DeviceAttestation {
  readonly kind: AttestationKind;
  readonly platform: DevicePlatform;
  prepare(): Promise<void>;
  attestKey(binding: Hex): Promise<EnrolmentAttestation>;
  assertCapture(binding: Hex): Promise<CaptureAttestation>;
}

export class AttestationUnavailableError extends Error {
  override name = "AttestationUnavailableError";
}
