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
    if (!navigator.mediaDevices?.getUserMedia) { setCam("unsupported"); return; }
    setCam("requesting");
    void loadModel();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false });
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      setCam("on");
    } catch (e: any) {
      setCam(e?.name === "NotAllowedError" ? "denied" : "error");
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
