import { useCallback, useEffect, useRef, useState } from "react";

export type MicStatus = "idle" | "listening" | "no-speech" | "denied" | "network" | "unsupported" | "error";

/** Speak text aloud, then call `done` (with a fallback timer — Chrome sometimes never fires onend). */
export function speakThen(text: string, done?: () => void) {
  let called = false;
  const finish = () => { if (!called) { called = true; done?.(); } };
  if (typeof window === "undefined" || !window.speechSynthesis) return finish();
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1; u.lang = "en-IN";
  u.onend = finish; u.onerror = finish;
  window.speechSynthesis.speak(u);
  setTimeout(finish, text.length * 75 + 1500);
}

/** Real browser speech recognition (Web Speech API). */
export function useSpeechRecognition() {
  const recRef = useRef<any>(null);
  const [status, setStatus] = useState<MicStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    const w = window as any;
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => recRef.current?.abort?.();
  }, []);

  const stop = useCallback(() => { recRef.current?.abort?.(); recRef.current = null; setStatus("idle"); }, []);

  const listen = useCallback((onFinal: (alts: string[]) => void) => {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) { setStatus("unsupported"); return; }
    recRef.current?.abort?.();
    const r = new SR();
    r.lang = navigator.language?.startsWith("en") ? navigator.language : "en-IN";
    r.interimResults = true; r.maxAlternatives = 3; r.continuous = false;
    let got = false;
    setTranscript("");
    r.onstart = () => { console.log("[voice] listening", r.lang); setStatus("listening"); };
    r.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          got = true;
          const alts = Array.from(res as ArrayLike<any>).map((a) => a.transcript.trim());
          console.log("[voice] heard", alts);
          setTranscript(alts[0] ?? "");
          onFinal(alts);
        } else interim += res[0].transcript;
      }
      if (interim) setTranscript(interim);
    };
    r.onerror = (e: any) => {
      console.warn("[voice] error", e.error);
      const map: Record<string, MicStatus> = { "not-allowed": "denied", "service-not-allowed": "denied", "no-speech": "no-speech", network: "network", aborted: "idle", "audio-capture": "error" };
      setStatus(map[e.error] ?? "error");
    };
    r.onend = () => setStatus((s) => (s === "listening" ? (got ? "idle" : "no-speech") : s));
    try { r.start(); recRef.current = r; } catch (e) { console.error("[voice] start failed", e); setStatus("error"); }
  }, []);

  return { status, transcript, supported, listen, stop };
}
