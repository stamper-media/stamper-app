/**
 * Every user-facing string of the app that is not a tier sentence or the footer (those come
 * from @stamper/core). __tests__/copy.test.ts checks this table for banned words.
 */
export const COPY = {
  appName: "Stamper",
  tabs: { camera: "Camera", gallery: "Stamps", settings: "Settings" },
  camera: {
    permission: "Stamper needs the camera to take the photos it stamps.",
    grant: "Allow camera",
    photo: "Photo",
    video: "Video",
    stop: "Stop",
    refusedLens: "This camera cannot be used for stamping. Use a built-in camera.",
    notEnrolled: "Set up this device before the first capture.",
  },
  location: {
    toggle: "Record location",
    hint: "The public page shows only the area, about 1 km across. The exact position stays private.",
    permissionOff: "Location permission is off, so captures are taken without location.",
    recorded:
      "Location recorded. The public page shows only the area, about 1 km across; the exact position stays private.",
    denied: "Taken without location: location permission is off.",
    unavailable: "Taken without location: no position fix arrived in time.",
  },
  enrol: {
    title: "Set up this device",
    body: "Stamper creates a signing key on this phone and asks the platform to attest the app.",
    start: "Set up",
    working: "Setting up…",
    doneL1: "This device is set up with platform attestation.",
    doneL0: "This device is set up without platform attestation.",
    stubNotice: "Test mode: attestation is simulated.",
  },
  status: {
    captured: "Captured",
    hashing: "Preparing…",
    signed: "Signed on this device",
    uploading: "Uploading…",
    registering: "Registering on Filecoin… do not share yet",
    registered: "Registered. Preparing the share copy…",
    shareReady: "Share-ready",
    reissued:
      "The first registration did not go through. The capture was signed again; the earlier predicted code will never be used.",
    failed: "This capture could not be registered.",
    offline: "Captured offline. It will upload when you are back online.",
    androidUploadNotice: "Keep the app open while uploading.",
  },
  code: {
    predictedHint: "Predicted code, not final yet",
    copy: "Copy code",
    copied: "Copied",
    spoken: "Spoken form",
  },
  share: {
    button: "Share",
    locked: "Sharing unlocks once the stamp is registered and the share copy is on this phone.",
    previewBadge: "preview",
  },
  gallery: { empty: "No captures yet.", pending: "Waiting to upload" },
  settings: {
    device: "Device key",
    level: "Attestation level",
    queue: "Waiting uploads",
    retry: "Retry now",
    reset: "Forget this device key",
  },
  verify: { opening: "Opening the verify page…" },
} as const;

/** Flattens COPY into a list of strings (used by the banned-word test). */
export function allCopyStrings(node: unknown = COPY): string[] {
  if (typeof node === "string") return [node];
  if (node && typeof node === "object") return Object.values(node).flatMap(allCopyStrings);
  return [];
}
