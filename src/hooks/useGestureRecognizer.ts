import { useCallback, useEffect, useRef, useState } from "react";
import { CONFIDENCE_THRESHOLD, COOLDOWN_MS, GESTURE_BY_ID } from "@/lib/gestures";

export type CamStatus = "off" | "requesting" | "on" | "denied" | "error" | "unsupported";
export type ModelStatus = "idle" | "loading" | "ready" | "error";

export interface Detection {
  gesture: string; // raw category, "None" if nothing
  score: number | null;
  handPresent: boolean;
  holdProgress: number; // 0..1 toward stable trigger
}

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

export function useGestureRecognizer(onStable: (gestureId: string, score: number) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<any>(null);
  const drawRef = useRef<any>(null);
  const visionRef = useRef<any>(null);
  const rafRef = useRef<number>(0);
  const onStableRef = useRef(onStable);
  onStableRef.current = onStable;

  const [cam, setCam] = useState<CamStatus>("off");
  const [model, setModel] = useState<ModelStatus>("idle");
  const [modelError, setModelError] = useState<string | null>(null);
  const [det, setDet] = useState<Detection>({ gesture: "None", score: null, handPresent: false, holdProgress: 0 });
  const [fps, setFps] = useState(0);

  const loadModel = useCallback(async () => {
    if (recRef.current) return;
    setModel("loading");
    setModelError(null);
    try {
      const vision = await import("@mediapipe/tasks-vision");
      visionRef.current = vision;
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM);
      const make = (delegate: "GPU" | "CPU") =>
        vision.GestureRecognizer.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL, delegate },
          runningMode: "VIDEO",
          numHands: 1,
        });
      try { recRef.current = await make("GPU"); } catch { recRef.current = await make("CPU"); }
      setModel("ready");
    } catch (e: any) {
      setModel("error");
      setModelError(e?.message ?? "Failed to load model");
    }
  }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    const c = canvasRef.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setCam("off");
    setDet({ gesture: "None", score: null, handPresent: false, holdProgress: 0 });
  }, []);

  const start = useCallback(async () => {
    const log = (...a: unknown[]) => console.log("[camera]", ...a);
    if (!window.isSecureContext) { console.error("[camera] Not a secure context (https required)"); setCam("unsupported"); return; }
    if (!navigator.mediaDevices?.getUserMedia) { console.error("[camera] getUserMedia unavailable"); setCam("unsupported"); return; }
    setCam("requesting");
    streamRef.current?.getTracks().forEach((t) => t.stop());
    try {
      // Flexible constraints first (no facingMode — many desktop webcams report none), then bare fallback.
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      } catch (e: any) {
        if (e?.name === "NotAllowedError") throw e;
        console.warn("[camera] preferred constraints failed, retrying with video:true", e);
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      const track = stream.getVideoTracks()[0];
      log("stream acquired", { tracks: stream.getVideoTracks().length, label: track?.label, state: track?.readyState, muted: track?.muted, settings: track?.getSettings?.() });
      if (!track) throw new Error("Stream has no video track");
      track.onended = () => console.warn("[camera] track ended");
      track.onmute = () => console.warn("[camera] track muted (no frames from device)");
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) throw new Error("Video element not mounted");
      v.muted = true; v.autoplay = true; v.playsInline = true;
      v.setAttribute("playsinline", ""); v.setAttribute("muted", "");
      v.srcObject = stream;
      if (v.readyState < 1) {
        await new Promise<void>((res, rej) => {
          const t = setTimeout(() => rej(new Error("Timed out waiting for video metadata")), 8000);
          v.onloadedmetadata = () => { clearTimeout(t); res(); };
        });
      }
      log("metadata loaded", { w: v.videoWidth, h: v.videoHeight });
      await v.play();
      log("playing", { paused: v.paused, readyState: v.readyState });
      setCam("on");
      // Load the model only after video is live, so GPU init can't stall first frames.
      void loadModel();
    } catch (e: any) {
      console.error("[camera] init failed:", e?.name, e?.message, e);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCam(e?.name === "NotAllowedError" || e?.name === "SecurityError" ? "denied" : "error");
    }
  }, [loadModel]);

  // Recognition loop
  useEffect(() => {
    if (cam !== "on" || model !== "ready") return;
    const v = videoRef.current!;
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    const vision = visionRef.current;
    drawRef.current = new vision.DrawingUtils(ctx);
    let lastTime = -1;
    let candidate = "None";
    let candidateSince = 0;
    let latched: string | null = null; // gesture already fired, must disappear first
    let lastFire = 0;
    let frames = 0;
    let fpsT = performance.now();

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      if (v.readyState < 2 || v.currentTime === lastTime) return;
      lastTime = v.currentTime;
      const now = performance.now();
      if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
      let res: any;
      try { res = recRef.current.recognizeForVideo(v, now); } catch { return; }
      ctx.clearRect(0, 0, c.width, c.height);
      const lm = res.landmarks?.[0];
      let gesture = "None";
      let score: number | null = null;
      if (lm) {
        const top = res.gestures?.[0]?.[0];
        if (top) { score = top.score; if (top.score >= CONFIDENCE_THRESHOLD) gesture = top.categoryName; }
        // bounding box
        const xs = lm.map((p: any) => p.x), ys = lm.map((p: any) => p.y);
        const x0 = Math.min(...xs) * c.width - 16, y0 = Math.min(...ys) * c.height - 16;
        const x1 = Math.max(...xs) * c.width + 16, y1 = Math.max(...ys) * c.height + 16;
        const known = !!GESTURE_BY_ID[gesture];
        ctx.strokeStyle = known ? (gesture === "Open_Palm" ? "#ff4757" : "#5ee6ff") : "rgba(200,210,230,0.5)";
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        ctx.setLineDash([]);
        drawRef.current.drawConnectors(lm, vision.GestureRecognizer.HAND_CONNECTIONS, { color: "rgba(94,230,255,0.8)", lineWidth: 3 });
        drawRef.current.drawLandmarks(lm, { color: "#ffffff", fillColor: "#ff4757", lineWidth: 1, radius: 3 });
      }

      if (gesture !== candidate) { candidate = gesture; candidateSince = now; }
      if (latched && gesture !== latched) latched = null;
      const def = GESTURE_BY_ID[candidate];
      let progress = 0;
      if (def && latched !== candidate) {
        progress = Math.min(1, (now - candidateSince) / def.holdMs);
        if (progress >= 1 && now - lastFire > COOLDOWN_MS) {
          latched = candidate;
          lastFire = now;
          onStableRef.current(candidate, score ?? 0);
        }
      } else if (def && latched === candidate) progress = 1;

      setDet({ gesture, score, handPresent: !!lm, holdProgress: progress });
      frames++;
      if (now - fpsT > 1000) { setFps(frames); frames = 0; fpsT = now; }
    };
    loop();
    return () => cancelAnimationFrame(rafRef.current);
  }, [cam, model]);

  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  return { videoRef, canvasRef, cam, model, modelError, det, fps, start, stop, loadModel };
}
