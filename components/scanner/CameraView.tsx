"use client";
import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ImagePlus, SwitchCamera, Loader2, CameraOff, Check, Zap, ZapOff } from "lucide-react";
import { detectFrame, type Corners } from "@/lib/scanner/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DETECT_WIDTH = 640;
const STABLE_MS = 1300;
const STABLE_MOVE = 0.018; // of the frame
const SCENE_CHANGE_MOVE = 0.07;
const AUTO_KEY = "pf-scan-auto";

type CamError = { title: string; body: string };

function explain(e: unknown): CamError {
  const name = (e as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return { title: "Camera access is blocked", body: "Allow the camera for this site in your browser's address bar or settings, then try again. You can also upload a photo instead." };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return { title: "No camera found", body: "This device doesn't seem to have a camera. You can upload a photo of your document instead." };
  if (name === "NotReadableError" || name === "AbortError") return { title: "The camera is busy", body: "Another app may be using it. Close that app and try again, or upload a photo instead." };
  return { title: "The camera couldn't start", body: "Try again, or upload a photo of your document instead." };
}

const maxMove = (a: Corners, b: Corners) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])));

export function CameraView({
  pageCount,
  replacing,
  lastCaptured,
  engineError,
  onCapture,
  onUpload,
  onFinish,
}: {
  pageCount: number;
  replacing: boolean;
  /** corners of the previous capture: auto-capture waits for the page to change */
  lastCaptured: Corners | null;
  engineError: string | null;
  onCapture: (photo: Blob, liveCorners: Corners | null) => void;
  onUpload: (files: File[]) => void;
  onFinish: () => void;
}) {
  const video = React.useRef<HTMLVideoElement>(null);
  const uploadInput = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<CamError | null>(null);
  const [starting, setStarting] = React.useState(true);
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);
  const [cameras, setCameras] = React.useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [corners, setCorners] = React.useState<Corners | null>(null);
  const [progress, setProgress] = React.useState(0);
  const [engineReady, setEngineReady] = React.useState(false);
  const [auto, setAuto] = React.useState(true);
  const [flash, setFlash] = React.useState(false);
  const captured = React.useRef(false);
  const streamRef = React.useRef<MediaStream | null>(null);
  const autoRef = React.useRef(auto);
  autoRef.current = auto;

  React.useEffect(() => {
    try {
      if (localStorage.getItem(AUTO_KEY) === "off") setAuto(false);
    } catch {
      /* storage blocked: keep the default */
    }
  }, []);

  // camera lifecycle: the stream is always released when this view goes away
  React.useEffect(() => {
    let cancelled = false;
    setError(null);
    setStarting(true);
    setSize(null);
    const stop = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError({
          title: window.isSecureContext ? "This browser can't use the camera" : "The camera needs a secure connection",
          body: window.isSecureContext ? "Try a current version of Chrome, Edge, Safari or Firefox, or upload a photo instead." : "Browsers only allow camera access on https:// sites and localhost. Open Pagelyt through its https address, or upload a photo instead.",
        });
        setStarting(false);
        return;
      }
      const video4k = { width: { ideal: 3840 }, height: { ideal: 2160 } };
      const wanted: MediaTrackConstraints = deviceId ? { deviceId: { exact: deviceId }, ...video4k } : { facingMode: { ideal: "environment" }, ...video4k };
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: wanted, audio: false });
      } catch (e) {
        if ((e as DOMException).name !== "OverconstrainedError") throw e;
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      // device names and ids are only available after permission is granted
      const all = await navigator.mediaDevices.enumerateDevices();
      if (!cancelled) setCameras(all.filter((d) => d.kind === "videoinput"));
      setStarting(false);
    })().catch((e) => {
      if (cancelled) return;
      setError(explain(e));
      setStarting(false);
    });
    return () => {
      cancelled = true;
      stop();
      if (video.current) video.current.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, attempt]);

  const capture = React.useCallback(
    (liveCorners: Corners | null) => {
      const v = video.current;
      if (!v || !v.videoWidth || captured.current) return;
      captured.current = true;
      setFlash(true);
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext("2d")!.drawImage(v, 0, 0);
      c.toBlob((b) => (b ? onCapture(b, liveCorners) : (captured.current = false)), "image/jpeg", 0.94);
    },
    [onCapture],
  );

  // live detection loop: one frame at a time, so a slow device simply analyses fewer frames
  React.useEffect(() => {
    let stop = false;
    let smooth: Corners | null = null;
    let stableSince = 0;
    let lostSince = 0;
    let armed = !lastCaptured;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    const tick = async () => {
      const v = video.current;
      if (stop) return;
      if (v && v.videoWidth && v.readyState >= 2 && !document.hidden && !captured.current) {
        const k = DETECT_WIDTH / Math.max(v.videoWidth, v.videoHeight);
        canvas.width = Math.round(v.videoWidth * Math.min(1, k));
        canvas.height = Math.round(v.videoHeight * Math.min(1, k));
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
        try {
          const r = await detectFrame({ data: d.data, width: d.width, height: d.height });
          if (stop) return;
          setEngineReady(true);
          const now = performance.now();
          if (r.found && r.corners) {
            lostSince = 0;
            const raw = r.corners;
            const jumped = !smooth || maxMove(raw, smooth) > 0.06;
            const moved = !smooth || maxMove(raw, smooth) > STABLE_MOVE;
            const prev: Corners = smooth ?? raw;
            smooth = jumped ? raw : raw.map((p, i) => [prev[i][0] * 0.55 + p[0] * 0.45, prev[i][1] * 0.55 + p[1] * 0.45]);
            setCorners(smooth);
            if (moved) stableSince = now;
            if (!armed && lastCaptured && maxMove(smooth, lastCaptured) > SCENE_CHANGE_MOVE) armed = true;
            const p = autoRef.current && armed ? Math.min(1, (now - stableSince) / STABLE_MS) : 0;
            setProgress(p);
            if (p >= 1) capture(smooth);
          } else {
            lostSince ||= now;
            // the outline survives brief misses so it doesn't flicker
            if (now - lostSince > 450) {
              smooth = null;
              stableSince = 0;
              setCorners(null);
              setProgress(0);
            }
            // the page was taken away: the next one may auto-capture
            if (now - lostSince > 1200) armed = true;
          }
        } catch {
          // engine errors surface through the parent's prepare call
          await new Promise((res) => setTimeout(res, 800));
        }
      }
      if (!stop) setTimeout(tick, 90);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [capture, lastCaptured]);

  const toggleAuto = () => {
    setAuto((a) => {
      try {
        localStorage.setItem(AUTO_KEY, a ? "off" : "on");
      } catch {
        /* preference just won't persist */
      }
      return !a;
    });
  };

  const switchCamera = () => {
    if (cameras.length < 2) return;
    const currentId = streamRef.current?.getVideoTracks()[0]?.getSettings().deviceId;
    const i = cameras.findIndex((c) => c.deviceId === currentId);
    setCorners(null);
    setDeviceId(cameras[(i + 1) % cameras.length].deviceId);
  };

  const ready = !!size && !error;
  const status = !ready ? "" : !engineReady ? "Preparing document detection…" : !corners ? "Point the camera at a document" : progress > 0 ? "Hold still…" : auto ? "Page found. Hold steady" : "Page found";

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-black text-white">
      {/* top bar */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent px-3 pb-8 pt-3">
        <Link href="/tools" aria-label="Close scanner" className="inline-flex size-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-md hover:bg-white/20">
          <ChevronLeft className="size-5" />
        </Link>
        <p className="min-w-0 flex-1 truncate text-center text-sm font-medium" aria-live="polite" data-testid="scan-status">
          {replacing ? "Retaking page" : status}
        </p>
        <button
          type="button"
          onClick={toggleAuto}
          aria-pressed={auto}
          className={cn("inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold backdrop-blur-md transition-colors", auto ? "bg-white text-black" : "bg-white/10 text-white hover:bg-white/20")}
        >
          {auto ? <Zap className="size-3.5" /> : <ZapOff className="size-3.5" />} Auto {auto ? "on" : "off"}
        </button>
      </div>

      {/* preview */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video
          ref={video}
          playsInline
          muted
          autoPlay
          aria-label="Camera preview"
          onLoadedMetadata={(e) => setSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
          onResize={(e) => setSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
          className="absolute inset-0 size-full object-contain"
        />
        {size && corners && (
          // same viewBox as the video and "meet" scaling, so the outline lines up exactly with object-contain
          <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="xMidYMid meet" className="pointer-events-none absolute inset-0 size-full" data-testid="scan-outline">
            <polygon
              points={corners.map(([x, y]) => `${x * size.w},${y * size.h}`).join(" ")}
              fill={progress > 0 ? "rgb(48 209 88 / 0.2)" : "rgb(10 132 255 / 0.18)"}
              stroke={progress > 0 ? "#30d158" : "#0a84ff"}
              strokeWidth={Math.max(size.w, size.h) / 320}
              strokeLinejoin="round"
              className="transition-[fill,stroke] duration-200"
            />
          </svg>
        )}
        <div aria-hidden className={cn("pointer-events-none absolute inset-0 bg-white transition-opacity", flash ? "opacity-70 duration-75" : "opacity-0 duration-300")} />
        {starting && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-white/80">
            <Loader2 className="size-6 animate-spin" />
            Starting camera. Allow access if your browser asks.
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="w-full max-w-sm rounded-2xl bg-white/10 p-6 text-center backdrop-blur-md" role="alert">
              <CameraOff className="mx-auto mb-3 size-8 text-white/70" strokeWidth={1.5} />
              <p className="text-lg font-semibold">{error.title}</p>
              <p className="mt-1.5 text-sm text-white/75">{error.body}</p>
              <div className="mt-5 flex justify-center gap-2">
                <Button onClick={() => setAttempt((a) => a + 1)}>Try again</Button>
                <Button variant="primary" onClick={() => uploadInput.current?.click()}>
                  Upload a photo
                </Button>
              </div>
            </div>
          </div>
        )}
        {engineError && (
          <p role="alert" className="absolute inset-x-4 top-20 z-20 rounded-xl bg-[#d70015]/90 px-4 py-2.5 text-center text-sm">
            {engineError}
          </p>
        )}
      </div>

      {/* controls */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        <div className="flex w-24 justify-start">
          <button type="button" onClick={() => uploadInput.current?.click()} aria-label="Upload a photo" title="Upload a photo" className="inline-flex size-12 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20">
            <ImagePlus className="size-5" />
          </button>
          <input
            ref={uploadInput}
            type="file"
            accept="image/*"
            multiple={!replacing}
            className="sr-only"
            tabIndex={-1}
            data-testid="scan-upload"
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (list.length) onUpload(list);
            }}
          />
        </div>

        <button
          type="button"
          onClick={() => capture(corners)}
          disabled={!ready}
          aria-label="Capture page"
          className="group relative flex size-[76px] items-center justify-center rounded-full disabled:opacity-40"
        >
          <svg viewBox="0 0 76 76" aria-hidden className="absolute inset-0 -rotate-90">
            <circle cx="38" cy="38" r="35" fill="none" stroke="white" strokeWidth="4" />
            {progress > 0 && <circle cx="38" cy="38" r="35" fill="none" stroke="#30d158" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${progress * 220} 220`} />}
          </svg>
          <span className="size-[60px] rounded-full bg-white transition-transform duration-150 group-active:scale-90" />
        </button>

        <div className="flex w-24 items-center justify-end gap-2">
          {cameras.length > 1 && (
            <button type="button" onClick={switchCamera} aria-label="Switch camera" title="Switch camera" className="inline-flex size-12 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20">
              <SwitchCamera className="size-5" />
            </button>
          )}
          {pageCount > 0 && (
            <button type="button" onClick={onFinish} aria-label={`Finish scanning, ${pageCount} page${pageCount === 1 ? "" : "s"}`} className="inline-flex h-12 items-center gap-1.5 rounded-full bg-[#0a84ff] px-3.5 text-sm font-semibold">
              <Check className="size-4" /> {pageCount}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
