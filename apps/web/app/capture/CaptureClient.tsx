"use client";

import { stamperDomain } from "@stamper/core";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import type { WebChainId } from "../../lib/config";
import { indexedDbKeyStore } from "../../lib/webkey";
import { hashBlob } from "../../lib/worker-hasher";
import { CAPTURE } from "./copy";
import {
  CaptureError,
  type CaptureResult,
  MAX_WEB_BYTES,
  type MediaMeta,
  type Step,
  stampBlob,
} from "./flow";

type Props = {
  apiUrl: string;
  chainId: WebChainId;
  registry: Address;
  /** the Explorer's origin: stamp pages live there. */
  verifyBase: string;
};
type State =
  | { kind: "idle" }
  | { kind: "busy"; step: Step }
  | { kind: "done"; result: CaptureResult }
  | { kind: "error"; message: string };

const APP_INFO = { id: "media.stamper.web", version: "1.0.0", build: "web" };

/** flow steps → the five stages the screen shows */
const STEP_INDEX: Record<Step, number> = {
  key: 0,
  enrol: 0,
  hash: 1,
  open: 2,
  upload: 2,
  sign: 3,
  submit: 3,
  wait: 4,
  done: 5,
};
const STEPS_TOTAL = 5;

function errorMessage(e: unknown): string {
  const code = e instanceof CaptureError ? e.code : e instanceof DOMException ? e.name : "";
  const table = CAPTURE.errors as Record<string, string>;
  if (code === "NotAllowedError") return CAPTURE.errors.CameraDenied;
  if (code === "NotFoundError") return CAPTURE.errors.NoCamera;
  if (code === "LengthOutOfBounds") return CAPTURE.errors.TooLarge;
  return table[code] ?? `${CAPTURE.errors.generic} (${code || "unknown"}).`;
}

async function metaOf(blob: Blob, facing?: "front" | "back"): Promise<MediaMeta> {
  const mediaType = blob.type || "application/octet-stream";
  if (mediaType.startsWith("image/")) {
    const bmp = await createImageBitmap(blob);
    const dims = { w: bmp.width, h: bmp.height };
    bmp.close();
    return { mediaType, dims, ...(facing ? { facing } : {}) };
  }
  if (mediaType.startsWith("video/")) {
    const url = URL.createObjectURL(blob);
    try {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.src = url;
      await new Promise<void>((res, rej) => {
        v.onloadedmetadata = () => res();
        v.onerror = () => rej(new CaptureError("UnsupportedType"));
      });
      const durationMs = Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : undefined;
      return {
        mediaType,
        dims: {
          w: v.videoWidth,
          h: v.videoHeight,
          ...(durationMs !== undefined ? { durationMs } : {}),
        },
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  throw new CaptureError("UnsupportedType");
}

export function CaptureClient({ apiUrl, chainId, registry, verifyBase }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [facing, setFacing] = useState<"front" | "back">("back");
  const [dragging, setDragging] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const domain = useMemo(() => stamperDomain(chainId, registry), [chainId, registry]);

  useEffect(() => {
    if (video.current) video.current.srcObject = camera;
    return () =>
      camera?.getTracks().forEach((t) => {
        t.stop();
      });
  }, [camera]);

  const run = useCallback(
    async (blob: Blob, f?: "front" | "back") => {
      try {
        if (!globalThis.crypto?.subtle) throw new CaptureError("NoWebCrypto");
        if (blob.size > MAX_WEB_BYTES) throw new CaptureError("TooLarge");
        setState({ kind: "busy", step: "hash" });
        const meta = await metaOf(blob, f);
        const result = await stampBlob(blob, meta, {
          apiUrl,
          domain,
          appInfo: APP_INFO,
          store: indexedDbKeyStore(),
          hash: (b) => hashBlob(b),
          onStep: (step) => setState({ kind: "busy", step }),
        });
        setState({ kind: "done", result });
      } catch (e) {
        setState({ kind: "error", message: errorMessage(e) });
      }
    },
    [apiUrl, domain],
  );

  const openCamera = async () => {
    try {
      const mode = facing === "front" ? "user" : "environment";
      setCamera(
        await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode }, audio: false }),
      );
    } catch (e) {
      setState({ kind: "error", message: errorMessage(e) });
    }
  };

  const shoot = async () => {
    const v = video.current;
    if (!v?.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.92));
    camera?.getTracks().forEach((t) => {
      t.stop();
    });
    setCamera(null);
    if (blob) await run(blob, facing);
  };

  const busy = state.kind === "busy";
  const stepIndex = busy ? STEP_INDEX[state.step] : state.kind === "done" ? STEPS_TOTAL : -1;
  const stopCamera = () => {
    camera?.getTracks().forEach((t) => {
      t.stop();
    });
    setCamera(null);
  };
  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && !busy) void run(f);
  };

  return (
    <div className="check-card cap-card">
      {state.kind === "done" ? (
        <section className="cap-done" data-testid="capture-done">
          <div className="cap-done-head">
            <span className="cap-done-icon" aria-hidden="true">
              ✓
            </span>
            <h2>{CAPTURE.doneTitle}</h2>
          </div>
          <span className="label">
            {state.result.final ? CAPTURE.codeLabel : CAPTURE.pendingCode}
          </span>
          <code className="cap-code">{state.result.code}</code>
          {state.result.final ? null : <p className="small muted">{CAPTURE.pendingNote}</p>}
          <div className="cap-actions">
            <a className="btn primary" href={`${verifyBase}/s/${state.result.code}`}>
              {CAPTURE.openStamp}
            </a>
            <button type="button" className="btn" onClick={() => setState({ kind: "idle" })}>
              {CAPTURE.another}
            </button>
          </div>
        </section>
      ) : (
        <>
          <div className={`cap-viewfinder${camera ? " live" : ""}${busy ? " busy" : ""}`}>
            <span className="cap-corner tl" aria-hidden="true" />
            <span className="cap-corner tr" aria-hidden="true" />
            <span className="cap-corner bl" aria-hidden="true" />
            <span className="cap-corner br" aria-hidden="true" />
            {camera ? (
              <video ref={video} autoPlay playsInline muted />
            ) : busy ? (
              <ol className="cap-steps">
                {CAPTURE.stepper.map((s, i) => (
                  <li
                    key={s.id}
                    className={i < stepIndex ? "done" : i === stepIndex ? "active" : undefined}
                  >
                    <span className="cap-step-dot" aria-hidden="true" />
                    {s.label}
                  </li>
                ))}
              </ol>
            ) : (
              <span className="cap-idle">
                <span className="cap-diamond" aria-hidden="true" />
                {CAPTURE.viewfinderIdle}
              </span>
            )}
          </div>

          {busy ? (
            <p className="cap-status" role="status" aria-live="polite">
              <span className="cap-spinner" aria-hidden="true" />
              {CAPTURE.steps[state.step]}
            </p>
          ) : camera ? (
            <div className="cap-actions">
              <button type="button" className="btn primary cap-shutter" onClick={shoot}>
                <span className="cap-shutter-dot" aria-hidden="true" />
                {CAPTURE.cameraShoot}
              </button>
              <button type="button" className="btn" onClick={stopCamera}>
                {CAPTURE.cameraStop}
              </button>
            </div>
          ) : (
            <div className="cap-actions">
              <button type="button" className="btn primary" onClick={openCamera}>
                {CAPTURE.cameraStart}
              </button>
              <fieldset className="cap-facing" aria-label={CAPTURE.facing}>
                {(["back", "front"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={facing === f}
                    onClick={() => setFacing(f)}
                  >
                    {f === "back" ? CAPTURE.facingBack : CAPTURE.facingFront}
                  </button>
                ))}
              </fieldset>
            </div>
          )}

          {state.kind === "error" && (
            <p className="cap-error" role="alert">
              {state.message}
            </p>
          )}

          <div className="or">{CAPTURE.or}</div>

          <label
            className={`cap-drop${dragging ? " over" : ""}${busy ? " disabled" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <span className="cap-drop-title">{CAPTURE.dropHere}</span>
            <span className="btn">{CAPTURE.chooseFile}</span>
            <input
              type="file"
              accept="image/jpeg,video/mp4,video/quicktime"
              className="visually-hidden"
              disabled={busy}
              data-testid="capture-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void run(f);
              }}
            />
          </label>
        </>
      )}

      <details className="cap-key">
        <summary>{CAPTURE.keyTitle}</summary>
        <p>{CAPTURE.keyNote}</p>
        <p>{CAPTURE.quota}</p>
      </details>
    </div>
  );
}
