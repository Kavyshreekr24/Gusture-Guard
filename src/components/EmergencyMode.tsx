import { useCallback, useEffect, useRef, useState } from "react";
import { speakThen, useSpeechRecognition, type MicStatus } from "@/hooks/useSpeech";
import { contactTarget, matchIntent, serviceTargets, telHref, type Contact, type MatchResult, type ServiceSettings, type Target } from "@/lib/emergency";

const PROMPT = "Emergency mode activated. Who would you like to call? You can say Police, Ambulance, Mom, Dad, or Friend.";

const MIC_TEXT: Record<MicStatus, string> = {
  idle: "Microphone off",
  listening: "Listening… speak now",
  "no-speech": "Didn't hear anything",
  denied: "Microphone permission denied",
  network: "Voice service unreachable (needs internet)",
  unsupported: "Voice not supported in this browser",
  error: "Microphone error",
};

interface Props {
  open: boolean;
  demo: boolean;
  contacts: Contact[];
  settings: ServiceSettings;
  onClose: () => void;
  onLog: (kind: "detect" | "action" | "system" | "warn", text: string) => void;
}

export function EmergencyMode({ open, demo, contacts, settings, onClose, onLog }: Props) {
  const mic = useSpeechRecognition();
  const [result, setResult] = useState<MatchResult | null>(null);
  const [callNote, setCallNote] = useState<string | null>(null);
  const attempts = useRef(0);
  const ctx = useRef({ contacts, settings, onLog });
  ctx.current = { contacts, settings, onLog };

  const handle = useCallback((alts: string[]) => {
    const { contacts, settings, onLog } = ctx.current;
    const r = matchIntent(alts, contacts, settings);
    setResult(r);
    onLog("detect", `Voice: "${r.heard}" → ${r.type === "found" ? r.target.name : r.type === "missing" ? `no ${r.label} saved` : "not understood"}`);
    if (r.type === "found") speakThen(`${r.target.title}. ${r.target.phone.split("").join(" ")}. Tap the green call button.`);
    else if (r.type === "missing") speakThen(`You have no contact saved as ${r.label}. Tap a button on screen.`);
    else retry("Sorry, I didn't understand.");
  }, []);

  const ask = useCallback((text: string) => {
    speakThen(text, () => mic.listen(handle));
  }, [mic, handle]);

  const retry = useCallback((why: string) => {
    attempts.current++;
    if (attempts.current <= 2) ask(`${why} Please say who to call.`);
    else speakThen(`${why} Please tap a button on screen.`);
  }, [ask]);

  // open → greet and listen
  useEffect(() => {
    if (!open) return;
    attempts.current = 0; setResult(null); setCallNote(null);
    ask(PROMPT);
    return () => { mic.stop(); window.speechSynthesis?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // no speech → ask again
  useEffect(() => {
    if (open && mic.status === "no-speech" && !result) retry("I didn't hear anything.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mic.status]);

  if (!open) return null;

  const onCall = (t: Target) => {
    if (demo) { setCallNote(`Demo Mode: simulated — no call was made to ${t.name}.`); onLog("action", `SIMULATED call to ${t.name} (${t.phone}) — no call made`); }
    else { setCallNote(`Opening your phone dialer for ${t.phone}. The call starts only when your phone places it.`); onLog("action", `Opened dialer for ${t.name} (${t.phone}) — call not verified`); }
  };

  const found = result?.type === "found" ? result.target : null;
  const services = serviceTargets(settings);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="em-title" className="fixed inset-0 z-50 overflow-y-auto bg-background/97 backdrop-blur-md animate-in fade-in duration-200">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-5 px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-primary">● Emergency mode activated</p>
            <h2 id="em-title" className="mt-1 text-3xl font-bold md:text-4xl">Who would you like to call?</h2>
            <p className="mt-1 text-base text-muted-foreground">Say "Police", "Ambulance", "Mom", "Dad" or "Friend" — or tap a button.</p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-xl border-2 border-foreground/60 px-4 py-3 font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">I'm safe · Exit</button>
        </div>

        {demo && <p className="rounded-lg border border-warning/50 bg-warning/10 px-4 py-2 text-sm text-warning">Demo Mode: call buttons are simulated. Turn Demo Mode off to dial for real.</p>}

        {/* Mic */}
        <div className={`panel flex flex-wrap items-center gap-4 p-4 ${mic.status === "listening" ? "border-accent glow-cyan" : ""}`} aria-live="polite">
          <span className={`grid h-14 w-14 place-items-center rounded-full text-2xl ${mic.status === "listening" ? "bg-accent text-accent-foreground pulse-dot" : "bg-muted"}`} aria-hidden>🎙️</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{mic.supported ? MIC_TEXT[mic.status] : MIC_TEXT.unsupported}</p>
            <p className="truncate text-lg">{mic.transcript ? <>You said: <strong className="text-accent">"{mic.transcript}"</strong></> : <span className="text-muted-foreground">Your words will appear here.</span>}</p>
          </div>
          {mic.supported && mic.status !== "listening" && (
            <button onClick={() => { attempts.current = 0; setResult(null); mic.listen(handle); }} className="rounded-xl bg-accent px-5 py-3 font-semibold text-accent-foreground hover:brightness-110">Speak again</button>
          )}
        </div>

        {/* Result */}
        {found && (
          <div className="panel border-success p-5 animate-in zoom-in-95 duration-200">
            <p className="text-sm text-muted-foreground">Recognised: "{result?.heard}"</p>
            <p className="mt-1 text-3xl font-bold">{found.icon} {found.title}</p>
            <p className="text-lg">{found.name} · <span className="font-mono">{found.phone}</span></p>
            <CallButton target={found} demo={demo} onCall={onCall} big />
          </div>
        )}
        {result?.type === "missing" && <p className="panel border-warning p-4 text-lg text-warning">No contact saved as "{result.label}". Choose someone below, or add one in Emergency Contacts.</p>}
        {result?.type === "none" && <p className="panel border-warning p-4 text-lg text-warning">Didn't understand "{result.heard}". Please repeat or tap a button.</p>}
        {(mic.status === "denied" || mic.status === "unsupported" || mic.status === "network" || !mic.supported) && (
          <p className="panel border-primary p-4 text-base">Voice isn't available right now — tap one of the large buttons below.</p>
        )}
        {callNote && <p role="status" className="panel border-accent p-4 text-base text-accent">{callNote}</p>}

        {/* Manual buttons */}
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Emergency services</p>
          <div className="grid gap-3 sm:grid-cols-2">{services.map((t) => <CallButton key={t.key} target={t} demo={demo} onCall={onCall} />)}</div>
        </div>
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Your contacts</p>
          {contacts.length ? (
            <div className="grid gap-3 sm:grid-cols-2">{[...contacts].sort((a, b) => Number(b.primary) - Number(a.primary)).map((c) => <CallButton key={c.id} target={contactTarget(c)} demo={demo} onCall={onCall} />)}</div>
          ) : <p className="text-sm text-muted-foreground">No contacts saved yet.</p>}
        </div>
      </div>
    </div>
  );
}

export function CallButton({ target, demo, onCall, big }: { target: Target; demo: boolean; onCall: (t: Target) => void; big?: boolean }) {
  const cls = big
    ? "mt-4 flex w-full items-center justify-center gap-3 rounded-2xl bg-success py-5 text-2xl font-bold text-accent-foreground hover:brightness-110 focus-visible:outline-4 focus-visible:outline-ring"
    : `flex min-h-16 w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring ${target.kind === "service" ? "border-primary/70" : "border-border"}`;
  const inner = big ? <>📞 {demo ? "Simulate call" : "Call now"} · {target.phone}</> : (
    <><span className="text-3xl" aria-hidden>{target.icon}</span><span className="flex-1"><span className="block text-lg font-bold">{target.title}</span><span className="block text-sm text-muted-foreground">{target.name !== target.title ? `${target.name} · ` : ""}<span className="font-mono">{target.phone}</span></span></span><span className="text-2xl" aria-hidden>📞</span></>
  );
  if (demo) return <button onClick={() => onCall(target)} className={cls} aria-label={`Simulate call to ${target.name}`}>{inner}</button>;
  return <a href={telHref(target.phone)} onClick={() => onCall(target)} className={cls} aria-label={`Call ${target.name} at ${target.phone}`}>{inner}</a>;
}
