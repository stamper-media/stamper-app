import { inspectJpeg, minimiseJpeg, sniff } from "@stamper/minimise";
import type { CaptureMeta } from "./claim";

export const VIDEO_MAX_SECONDS = 180;
export const VIDEO_MAX_BYTES = 500 * 1024 * 1024;

/** Structural subset of expo-camera's CameraView ref used here. */
export interface CameraLike {
  takePictureAsync(opts: {
    exif?: boolean;
    quality?: number;
    imageType?: "jpg";
    shutterSound?: boolean;
  }): Promise<{ uri: string; exif?: unknown; width: number; height: number } | undefined>;
  recordAsync(opts: {
    maxDuration?: number;
    maxFileSize?: number;
  }): Promise<{ uri: string } | undefined>;
  getAvailableLensesAsync(): Promise<string[]>;
}

/** Virtual (fused multi-camera), external and continuity devices are refused (DESIGN §7.1). */
const NON_PHYSICAL = /(dual|triple|external|continuity|desk\s?view|virtual|usb)/i;

export function isPhysicalLens(name: string): boolean {
  return name.trim().length > 0 && !NON_PHYSICAL.test(name);
}

/** Chooses a single physical lens; throws when the device only offers virtual/external ones. */
export function choosePhysicalLens(lenses: string[], preferred?: string): string {
  if (preferred && lenses.includes(preferred) && isPhysicalLens(preferred)) return preferred;
  const lens = lenses.find(isPhysicalLens);
  if (!lens) throw new CaptureRefusedError("No built-in physical camera is available");
  return lens;
}

export class CaptureRefusedError extends Error {
  override name = "CaptureRefusedError";
}

export async function capturePhoto(
  camera: CameraLike,
  selectedLens?: string,
): Promise<{ uri: string; exif: unknown; physicalCameraIds: string[] }> {
  const lenses = await camera.getAvailableLensesAsync().catch(() => [] as string[]);
  // Android reports no lens names; the CameraX default back/front device is physical there.
  const lens =
    lenses.length > 0 ? choosePhysicalLens(lenses, selectedLens) : (selectedLens ?? "default");
  if (!isPhysicalLens(lens)) throw new CaptureRefusedError(`Lens ${lens} is not a built-in camera`);
  const pic = await camera.takePictureAsync({ exif: true, quality: 1, imageType: "jpg" });
  if (!pic?.uri) throw new Error("The camera returned no picture");
  return { uri: pic.uri, exif: pic.exif ?? null, physicalCameraIds: [lens] };
}

export async function captureVideo(
  camera: CameraLike,
): Promise<{ uri: string; durationMs: number }> {
  const started = Date.now();
  const v = await camera.recordAsync({
    maxDuration: VIDEO_MAX_SECONDS,
    maxFileSize: VIDEO_MAX_BYTES,
  });
  if (!v?.uri) throw new Error("The camera returned no video");
  return { uri: v.uri, durationMs: Math.min(Date.now() - started, VIDEO_MAX_SECONDS * 1000) };
}

export type PreparedPhoto = {
  bytes: Uint8Array;
  dims: { w: number; h: number };
  sanitised: CaptureMeta["sanitised"];
  publicExif: CaptureMeta["publicExif"];
};

/** EXIF minimisation before hashing: the minimised bytes are what gets hashed, signed and stored. */
export function prepareJpeg(
  raw: Uint8Array,
  fallbackDims?: { w: number; h: number },
): PreparedPhoto {
  const kind = sniff(raw);
  if (kind !== "image/jpeg") throw new CaptureRefusedError(`Expected a JPEG capture, got ${kind}`);
  const { bytes, report } = minimiseJpeg(raw);
  const dims =
    report.width && report.height
      ? { w: report.width, h: report.height }
      : (inspectJpeg(bytes).dims ?? fallbackDims ?? { w: 0, h: 0 });
  const publicExif: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(report.publicExif)) {
    if (typeof v === "string" || (typeof v === "number" && Number.isInteger(v))) publicExif[k] = v;
  }
  return {
    bytes,
    dims: { w: "w" in dims ? dims.w : 0, h: "h" in dims ? dims.h : 0 },
    sanitised: { removed: report.removed, kept: report.kept },
    publicExif,
  };
}
