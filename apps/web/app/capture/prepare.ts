/**
 * Metadata minimisation before hashing, as the mobile app does (apps/mobile/lib/capture.ts
 * prepareJpeg): the minimised bytes are what gets hashed, signed, uploaded and stored. JPEG and MP4
 * (or QuickTime) only, which is what the worker's pre-publication check accepts (no GPS, serials, MakerNote, MP4
 * udta or location; a JPEG Orientation tag present).
 *
 * A canvas photo (the camera path) has no Exif at all; its pixels are already upright, so an Exif
 * segment holding only Orientation = 1 is added. A chosen file keeps its own Orientation.
 */
import { inspectJpeg, minimiseJpeg, minimiseMp4, sniff } from "@stamper/minimise";

export type Prepared = {
  bytes: Uint8Array;
  mediaType: "image/jpeg" | "video/mp4" | "video/quicktime";
  sanitised: { removed: string[]; kept: string[] };
  publicExif: Record<string, string | number>;
  /** pixel dimensions read from the JPEG, when present. */
  dims?: { w: number; h: number };
};

export class UnsupportedMedia extends Error {
  constructor(readonly sniffed: string) {
    super(`only JPEG photos and MP4 videos can be stamped here (got ${sniffed})`);
    this.name = "UnsupportedMedia";
  }
}

/** APP1 "Exif\0\0" + big-endian TIFF with one IFD0 entry: Orientation (0x0112, SHORT) = 1. */
const ORIENTATION_1_APP1 = new Uint8Array([
  0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00,
  0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
]);

/** Inserts ORIENTATION_1_APP1 after SOI, or after a leading APP0 (JFIF) segment. */
export function withOrientation1(jpeg: Uint8Array): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("not a JPEG");
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4] ?? 0) << 8) + (jpeg[5] ?? 0);
  const out = new Uint8Array(jpeg.length + ORIENTATION_1_APP1.length);
  out.set(jpeg.subarray(0, at), 0);
  out.set(ORIENTATION_1_APP1, at);
  out.set(jpeg.subarray(at), at + ORIENTATION_1_APP1.length);
  return out;
}

function publicExifOf(x: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(x)) {
    if (typeof v === "string" || (typeof v === "number" && Number.isInteger(v))) out[k] = v;
  }
  return out;
}

export function prepareMedia(raw: Uint8Array): Prepared {
  const kind = sniff(raw);
  if (kind === "image/jpeg") {
    const { bytes, report } = minimiseJpeg(raw);
    const kept = [...report.kept];
    let out = bytes;
    if (inspectJpeg(bytes).orientation === undefined) {
      out = withOrientation1(bytes);
      kept.push("Orientation");
    }
    const dims = report.width && report.height ? { w: report.width, h: report.height } : undefined;
    return {
      bytes: out,
      mediaType: "image/jpeg",
      sanitised: { removed: report.removed, kept },
      publicExif: publicExifOf(report.publicExif),
      ...(dims ? { dims } : {}),
    };
  }
  if (kind === "video/mp4" || kind === "video/quicktime") {
    const { bytes, report } = minimiseMp4(raw);
    return {
      bytes,
      mediaType: kind,
      sanitised: { removed: report.removed, kept: report.kept },
      publicExif: {},
    };
  }
  throw new UnsupportedMedia(kind);
}
