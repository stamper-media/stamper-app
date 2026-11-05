/** User-facing strings of the web capture screen (WP-14). Banned words (plan §0.6) never appear. */
import { tierSentence } from "@stamper/core";

/** Level-0 tier sentence for a browser key, from @stamper/core (plan §4.10). */
export const WEB_TIER = tierSentence({
  level: 0,
  keyType: 1,
  countersigned: true,
  revokedBeforeStamp: false,
  registrarRemoved: false,
  offline: false,
  serverComputedCid: false,
});

export const CAPTURE = {
  title: "Stamp from this browser",
  eyebrow: "Stamp media",
  heroTitle: "Stamp it",
  heroAccent: "as it's taken.",
  heroLede:
    "Take a photo or choose a file. It is fingerprinted and signed in this browser, then registered onchain, where anyone can check it.",
  trust: ["Signed in your browser", "Hidden metadata removed first", "No account", "Open source"],
  tierLabel: "What this stamp says",
  viewfinderIdle: "Camera off",
  facing: "Camera",
  or: "or",
  fileTitle: "Stamp a file",
  dropHere: "Drop a photo or video here",
  stepper: [
    { id: "key", label: "Browser key" },
    { id: "hash", label: "Fingerprint" },
    { id: "upload", label: "Upload" },
    { id: "sign", label: "Sign" },
    { id: "wait", label: "Onchain" },
  ],
  doneTitle: "Stamped",
  pendingNote:
    "The chain has not confirmed it yet. The code is final once it does; the stamp page updates on its own.",
  lede: "Take a photo with your camera or choose a file. Both go through one path: the file is hashed in this browser, signed with this browser's key and registered on chain.",
  cameraStart: "Open camera",
  cameraShoot: "Take photo",
  cameraStop: "Close camera",
  cameraLabel: "Camera",
  facingBack: "Back camera",
  facingFront: "Front camera",
  chooseFile: "Choose a file",
  keyTitle: "About this browser's key",
  keyNote:
    "This browser holds a signing key that cannot be exported. Clearing this site's data deletes it. The next stamp then enrols a new key, and stamps made earlier stay registered.",
  quota: "A browser key can make up to 10 stamps per day.",
  openStamp: "Open the stamp page",
  another: "Stamp another file",
  steps: {
    key: "Preparing this browser's key…",
    enrol: "Registering this browser's key…",
    hash: "Hashing in this browser…",
    open: "Opening a capture…",
    upload: "Uploading…",
    sign: "Signing the claim…",
    submit: "Submitting the claim…",
    wait: "Waiting for the chain to record it… A first stamp from this browser usually takes 2 to 5 minutes.",
    done: "Stamp submitted",
  },
  codeLabel: "Stamp code",
  pendingCode: "Predicted code (final once the chain records it)",
  disabled: "Browser capture is not available on this site.",
  errors: {
    QuotaExceeded: "This browser reached today's limit of 10 stamps. Try again tomorrow.",
    RateLimited: "Too many requests. Wait a minute and try again.",
    CameraDenied: "Camera access was refused. You can choose a file instead.",
    NoCamera: "No camera was found. You can choose a file instead.",
    UnsupportedType: "Only JPEG photos and MP4 or MOV videos can be stamped.",
    MetadataMalformed: "This file's metadata could not be read safely, so nothing was stamped.",
    TooLarge: "This file is larger than 100 MB.",
    UploadChanged:
      "The uploaded bytes hash differently from the file in this browser. Nothing was stamped.",
    NoWebCrypto: "This browser cannot create a signing key here (a secure https page is needed).",
    WebCaptureDisabled: "Browser capture is switched off on this server.",
    generic: "Stamping failed",
  },
} as const;
