import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { type CameraLike, capturePhoto, captureVideo, prepareJpeg } from "./capture";
import type { CaptureMeta } from "./claim";
import { minimiseVideoFile, readAll, removeFile, writeCache } from "./files";
import { type CaptureLocation, expoLocationProvider, readCaptureLocation } from "./location";
import { stageCapture } from "./pipeline";
import { getRuntime, notifyQueueChange } from "./runtime";

const monotonicNs = () => BigInt(Math.round(performance.now() * 1e6)).toString();
const platform = (): "ios" | "android" => (Platform.OS === "ios" ? "ios" : "android");

type Cam = CameraLike & { lens: string | undefined; facing: "back" | "front" };

/** "Record location" for this capture (DESIGN §11.3); off unless the user turned it on. */
export type CaptureOptions = { recordLocation?: boolean };

/** Starts the fix read alongside the shot; resolves to undefined when location is off. Never rejects. */
function startLocation(opts: CaptureOptions): Promise<CaptureLocation | undefined> {
  return opts.recordLocation
    ? readCaptureLocation(expoLocationProvider())
    : Promise.resolve(undefined);
}

/** Live photo → EXIF minimisation → queue (signed now when offline) → drain. Returns the item id. */
export async function capturePhotoFlow(camera: Cam, opts: CaptureOptions = {}): Promise<string> {
  const rt = await getRuntime();
  const capturedAtMs = Date.now();
  const ns = monotonicNs();
  const location = startLocation(opts);
  const shot = await capturePhoto(camera, camera.lens);
  const raw = await readAll(shot.uri);
  const prepared = prepareJpeg(raw);
  const id = Crypto.randomUUID();
  const fileUri = writeCache(`capture-${id}.jpg`, prepared.bytes);
  removeFile(shot.uri); // the unminimised original never leaves the camera cache
  const meta: CaptureMeta = {
    mediaKind: 1,
    mediaType: "image/jpeg",
    dims: prepared.dims,
    capturedAtMs,
    monotonicNs: ns,
    platform: platform(),
    app: rt.cfg.app,
    facing: camera.facing,
    lensId: shot.physicalCameraIds[0] ?? "default",
    physicalCameraIds: shot.physicalCameraIds,
    sanitised: prepared.sanitised,
    publicExif: prepared.publicExif,
  };
  await stageCapture(rt.deps, rt.queue, {
    id,
    fileUri,
    meta,
    online: await rt.isOnline(),
    location: await location,
  });
  notifyQueueChange();
  void rt.drain();
  return id;
}

/** Live video (≤ 180 s / 500 MB) → MP4 metadata minimisation → queue; signed at upload. */
export async function captureVideoFlow(camera: Cam, opts: CaptureOptions = {}): Promise<string> {
  const rt = await getRuntime();
  const capturedAtMs = Date.now();
  const ns = monotonicNs();
  const location = startLocation(opts);
  const clip = await captureVideo(camera);
  const id = Crypto.randomUUID();
  const { uri, report } = await minimiseVideoFile(clip.uri, `capture-${id}.mp4`);
  removeFile(clip.uri);
  const meta: CaptureMeta = {
    mediaKind: 2,
    mediaType: "video/mp4",
    dims: { w: report.width ?? 0, h: report.height ?? 0, durationMs: clip.durationMs },
    capturedAtMs,
    monotonicNs: ns,
    platform: platform(),
    app: rt.cfg.app,
    facing: camera.facing,
    lensId: camera.lens ?? "default",
    physicalCameraIds: [camera.lens ?? "default"],
    sanitised: { removed: report.removed, kept: report.kept },
    publicExif: {},
  };
  await stageCapture(rt.deps, rt.queue, {
    id,
    fileUri: uri,
    meta,
    online: await rt.isOnline(),
    location: await location,
  });
  notifyQueueChange();
  void rt.drain();
  return id;
}
