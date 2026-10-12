import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useGestureRecognizer } from "@/hooks/useGestureRecognizer";
import { COUNTDOWN_S, GESTURES, GESTURE_BY_ID, type Command } from "@/lib/gestures";
import { CONTACT_LABELS, MAX_CONTACTS, REGIONS, guessRegion, serviceTargets, type Contact, type ContactLabel, type Region, type ServiceSettings, type Target } from "@/lib/emergency";
import { CallButton, EmergencyMode } from "@/components/EmergencyMode";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GestureGuard — AI Gesture Safety System" },
      { name: "description", content: "When words aren't an option, your gestures can speak. Real-time AI hand gesture recognition for personal safety." },
      { property: "og:title", content: "GestureGuard — AI Gesture Safety System" },
      { property: "og:description", content: "Trigger safety actions with hand gestures, processed locally in your browser." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

type AlertState = "ready" | "pending" | "active" | "cancelled";
type StepState = "done" | "pending" | "unavailable" | "simulated" | "failed";
type LocState = "unknown" | "requesting" | "granted" | "denied" | "unsupported" | "error";
interface Contact { name: string; phone: string }
interface LogItem { id: number; t: Date; kind: "detect" | "action" | "system" | "warn"; text: string }

function Dashboard() {
  const [alert, setAlert] = useState<AlertState>("ready");
  const [countdown, setCountdown] = useState(COUNTDOWN_S);
  const [demo, setDemo] = useState(true);
  const [speak, setSpeak] = useState(false);
  const [log, setLog] = useState<LogItem[]>([]);
  const [loc, setLoc] = useState<LocState>("unknown");
  const [coords, setCoords] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [notify, setNotify] = useState<StepState | null>(null);
  const [seen, setSeen] = useState<Record<string, number>>({});
  const [lastCmd, setLastCmd] = useState<string>("—");
  const [banner, setBanner] = useState<string | null>(null);
  const idRef = useRef(0);
  const alertRef = useRef(alert);
  alertRef.current = alert;
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const openRef = useRef(false);
  openRef.current = emergencyOpen;
  const loadedRef = useRef(false);
  const [settings, setSettings] = useState<ServiceSettings>({ region: "IN", ambulance: "", hospitalName: "", hospitalPhone: "" });

  const say = useCallback((text: string) => {
    if (!speak || typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }, [speak]);

  const add = useCallback((kind: LogItem["kind"], text: string) => {
    setLog((l) => [{ id: ++idRef.current, t: new Date(), kind, text }, ...l].slice(0, 60));
  }, []);

  // load contacts + service settings (stored only on this device)
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("gg-contacts") ?? "[]") as Partial<Contact>[];
      setContacts(raw.slice(0, MAX_CONTACTS).map((c, i) => ({ id: c.id ?? crypto.randomUUID(), name: c.name ?? "", phone: c.phone ?? "", label: c.label ?? "Other", primary: c.primary ?? i === 0 })));
    } catch {}
    try {
      const s = JSON.parse(localStorage.getItem("gg-services") ?? "null");
      setSettings(s ?? { region: guessRegion(), ambulance: "", hospitalName: "", hospitalPhone: "" });
    } catch { setSettings((s) => ({ ...s, region: guessRegion() })); }
    loadedRef.current = true;
    navigator.permissions?.query({ name: "geolocation" as PermissionName }).then((p) => {
      if (p.state === "granted") setLoc("granted");
      if (p.state === "denied") setLoc("denied");
    }).catch(() => {});
  }, []);
  useEffect(() => { if (loadedRef.current) localStorage.setItem("gg-contacts", JSON.stringify(contacts)); }, [contacts]);
  useEffect(() => { if (loadedRef.current) localStorage.setItem("gg-services", JSON.stringify(settings)); }, [settings]);

  const requestLocation = useCallback(() => new Promise<boolean>((resolve) => {
    if (!navigator.geolocation) { setLoc("unsupported"); add("warn", "Geolocation not supported by this browser"); return resolve(false); }
    setLoc("requesting");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLoc("granted");
        setCoords({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
        add("action", `Location obtained (±${Math.round(p.coords.accuracy)} m)`);
        resolve(true);
      },
      (e) => {
        setLoc(e.code === 1 ? "denied" : "error");
        add("warn", e.code === 1 ? "Location permission denied" : `Location error: ${e.message}`);
        resolve(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }), [add]);

  const startEmergency = useCallback((source: string) => {
    if (openRef.current) return;
    // No countdown: emergency help must be immediate. Exiting the screen cancels.
    setAlert("active"); setNotify(null); setEmergencyOpen(true);
    add("warn", `Emergency mode activated (${source})`);
    void requestLocation();
  }, [add, requestLocation]);

  const confirmAlert = useCallback((source: string) => {
    if (alertRef.current !== "pending") { add("system", `Confirm ignored — no pending alert (${source})`); return; }
    setAlert("active");
    add("action", `Alert confirmed (${source})${demo ? " — DEMO MODE" : ""}`);
    say("Alert confirmed.");
    void requestLocation();
    if (demo) { setNotify("simulated"); add("action", `SIMULATED: notification to ${contacts.length} trusted contact(s) — nothing was sent`); }
    else { setNotify("unavailable"); add("warn", "Real notification provider not configured — no message sent automatically"); }
  }, [add, say, demo, contacts.length, requestLocation]);

  const cancelAlert = useCallback((source: string) => {
    if (alertRef.current !== "pending" && alertRef.current !== "active") { add("system", `Cancel ignored — no alert (${source})`); return; }
    setAlert("cancelled"); setNotify(null);
    add("action", `Alert cancelled (${source})`);
    say("Alert cancelled.");
  }, [add, say]);

  const reset = useCallback((source: string) => {
    if (alertRef.current === "pending") { add("system", `Reset ignored — alert pending, use cancel (${source})`); return; }
    setAlert("ready"); setNotify(null); setCoords(null);
    add("action", `System reset to ready (${source})`);
    say("System ready.");
  }, [add, say]);

  const locationStatus = useCallback((source: string) => {
    const msg = loc === "granted" ? (coords ? "Location available and obtained" : "Location permission granted — not yet fetched")
      : loc === "denied" ? "Location permission denied — sharing unavailable"
      : loc === "unsupported" ? "Location unsupported in this browser" : "Location permission not yet requested";
    setBanner(msg); setTimeout(() => setBanner(null), 4000);
    add("action", `Location status shown (${source}): ${msg}`);
    say(msg);
  }, [loc, coords, add, say]);

  const run = useCallback((cmd: Command, source: string) => {
    setLastCmd(cmd);
    if (cmd === "emergency") startEmergency(source);
    if (cmd === "confirm") confirmAlert(source);
    if (cmd === "cancel") cancelAlert(source);
    if (cmd === "location") locationStatus(source);
    if (cmd === "reset") reset(source);
  }, [startEmergency, confirmAlert, cancelAlert, locationStatus, reset]);

  const onStable = useCallback((id: string, score: number) => {
    const g = GESTURE_BY_ID[id];
    if (!g || openRef.current) return; // ignore gestures while emergency mode is on screen
    setSeen((s) => ({ ...s, [id]: Math.max(s[id] ?? 0, score) }));
    add("detect", `${g.label} recognised (${(score * 100).toFixed(0)}%) → ${g.commandLabel}`);
    run(g.command, "gesture");
  }, [add, run]);

  const rec = useGestureRecognizer(onStable);

  // countdown → auto confirm
  useEffect(() => {
    if (alert !== "pending") return;
    if (countdown <= 0) { confirmAlert("countdown elapsed"); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [alert, countdown, confirmAlert]);

  useEffect(() => { add("system", "GestureGuard loaded — Demo Mode on. Camera off."); }, [add]);

  const current = GESTURE_BY_ID[rec.det.gesture];
  const mapsUrl = coords ? `https://maps.google.com/?q=${coords.lat},${coords.lng}` : "";
  const smsBody = encodeURIComponent(`I need help. ${coords ? `My location: ${mapsUrl}` : "Location unavailable."} — sent via GestureGuard`);

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 md:py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/15 text-2xl glow-red" aria-hidden>✋</div>
          <div>
            <h1 className="text-xl font-bold tracking-tight md:text-2xl">Gesture<span className="text-primary">Guard</span></h1>
            <p className="text-xs text-muted-foreground md:text-sm">When words aren't an option, your gestures can speak.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => startEmergency("manual button")} className="rounded-full bg-primary px-5 py-2 text-sm font-bold uppercase tracking-wider text-primary-foreground glow-red hover:brightness-110 focus-visible:outline-2 focus-visible:outline-ring">🆘 Emergency</button>
          <Toggle label="Demo Mode" on={demo} onChange={(v) => { setDemo(v); add("system", `Demo Mode ${v ? "enabled" : "disabled"}`); }} tone={demo ? "warning" : "primary"} />
          <Toggle label="Voice" on={speak} onChange={setSpeak} />
        </div>
      </header>

      {demo && (
        <div className="mb-5 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning" role="note">
          <strong>Demo Mode:</strong> no real messages are sent and no emergency services are contacted. Simulated actions are labelled.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        {/* Camera */}
        <section className="panel overflow-hidden" aria-label="Camera">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className={`h-2.5 w-2.5 rounded-full ${rec.cam === "on" ? "bg-primary pulse-dot" : "bg-muted-foreground/50"}`} />
              {rec.cam === "on" ? "CAMERA ACTIVE · processed locally" : "Camera off"}
            </div>
            <span className="font-mono text-xs text-muted-foreground">{rec.cam === "on" && rec.model === "ready" ? `${rec.fps} fps` : ""}</span>
          </div>
          <div className="relative aspect-[4/3] bg-background">
            <video ref={rec.videoRef} autoPlay playsInline muted className="absolute inset-0 z-0 h-full w-full -scale-x-100 object-cover" />
            <canvas ref={rec.canvasRef} className="pointer-events-none absolute inset-0 z-[1] h-full w-full -scale-x-100 object-cover bg-transparent" />
            {rec.cam !== "on" && (
              <div className="absolute inset-0 grid place-items-center p-6 text-center">
                <div className="max-w-sm space-y-3">
                  <p className="text-4xl" aria-hidden>📷</p>
                  <p className="text-sm text-muted-foreground">
                    {rec.cam === "requesting" && "Waiting for camera permission…"}
                    {rec.cam === "off" && "Start the camera to begin gesture recognition. Frames never leave your device."}
                    {rec.cam === "denied" && "Camera permission was denied. Allow camera access in your browser's site settings, then retry."}
                    {rec.cam === "error" && "The camera couldn't start. It may be in use by another app."}
                    {rec.cam === "unsupported" && "This browser doesn't support camera access. Try recent Chrome, Edge, Safari or Firefox."}
                  </p>
                  {rec.cam !== "requesting" && rec.cam !== "unsupported" && (
                    <button onClick={rec.start} className="rounded-lg bg-primary px-5 py-2.5 font-semibold text-primary-foreground glow-red transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-ring">
                      {rec.cam === "off" ? "Start camera" : "Retry"}
                    </button>
                  )}
                </div>
              </div>
            )}
            {rec.cam === "on" && rec.model === "loading" && <Overlay text="Loading AI gesture model…" />}
            {rec.model === "error" && (
              <div className="absolute inset-x-4 bottom-4 rounded-lg bg-destructive/90 p-3 text-sm text-destructive-foreground">
                Model failed to load: {rec.modelError}{" "}
                <button className="underline" onClick={rec.loadModel}>Retry</button>
              </div>
            )}
            {banner && <div className="absolute inset-x-4 top-4 rounded-lg border border-accent/50 bg-card/95 p-3 text-center text-sm text-accent glow-cyan" role="status">📍 {banner}</div>}
            {rec.cam === "on" && rec.model === "ready" && (
              <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 rounded-lg bg-card/85 p-3 backdrop-blur">
                <span className="text-3xl" aria-hidden>{current?.emoji ?? (rec.det.handPresent ? "🖐" : "·")}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-semibold">{current ? `${current.label} → ${current.commandLabel}` : rec.det.handPresent ? "Hand detected — no command gesture" : "No hand in view"}</span>
                    <span className="font-mono text-muted-foreground">{rec.det.score != null ? `${(rec.det.score * 100).toFixed(0)}%` : "—"}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full transition-[width] duration-100 ${current?.command === "emergency" ? "bg-primary" : "bg-accent"}`} style={{ width: `${rec.det.holdProgress * 100}%` }} />
                  </div>
                </div>
              </div>
            )}
          </div>
          {rec.cam === "on" && (
            <div className="flex justify-end border-t px-4 py-2.5">
              <button onClick={() => { rec.stop(); add("system", "Camera stopped by user"); }} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">Stop camera</button>
            </div>
          )}
        </section>

        {/* Emergency panel */}
        <section aria-live="assertive" className={`panel p-5 ${alert === "pending" || alert === "active" ? "border-primary glow-red" : ""}`}>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Emergency status</p>
          {alert === "ready" && <StatusBlock tone="success" title="Ready" desc="Hold an open palm for 1.5s to start the emergency workflow." />}
          {alert === "cancelled" && <StatusBlock tone="muted" title="Alert cancelled" desc="Point one finger up to return to ready." />}
          {alert === "pending" && (
            <div className="mt-3 space-y-4">
              <h2 className="text-2xl font-bold text-primary">Potential Emergency Detected</h2>
              <div className="flex items-center gap-4">
                <div className="grid h-20 w-20 place-items-center rounded-full border-4 border-primary font-mono text-3xl font-bold">{countdown}</div>
                <p className="text-sm text-muted-foreground">Auto-confirms when the timer ends. 👍 to confirm now, ✊ to cancel.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => run("confirm", "button")} className="rounded-lg bg-primary py-3 font-semibold text-primary-foreground hover:brightness-110 focus-visible:outline-2 focus-visible:outline-ring">Confirm</button>
                <button onClick={() => run("cancel", "button")} className="rounded-lg border-2 border-foreground/70 py-3 font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">Cancel</button>
              </div>
            </div>
          )}
          {alert === "active" && (
            <div className="mt-3 space-y-3">
              <h2 className="text-2xl font-bold text-primary">{demo ? "Alert active (Demo)" : "Alert active"}</h2>
              <p className="text-sm text-muted-foreground">Emergency services have <strong>not</strong> been contacted by this app. Call your local emergency number if you can.</p>
              <div className="flex flex-wrap gap-2">
                {!demo && contacts[0] && (
                  <a href={`sms:${contacts.map((c) => c.phone).join(",")}?&body=${smsBody}`} onClick={() => add("action", "Opened device messaging app — delivery not verified")} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Open SMS to contacts</a>
                )}
                {coords && <a href={mapsUrl} target="_blank" rel="noreferrer" className="rounded-lg border px-4 py-2 text-sm hover:bg-muted">View my location</a>}
                <button onClick={() => run("cancel", "button")} className="rounded-lg border px-4 py-2 text-sm hover:bg-muted">Cancel alert</button>
              </div>
            </div>
          )}

          <div className="mt-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Safety checklist</p>
            <ul className="space-y-2 text-sm">
              <Step label="Emergency triggered" s={alert === "ready" ? "pending" : "done"} />
              <Step label="Alert confirmed" s={alert === "active" ? "done" : alert === "cancelled" ? "unavailable" : "pending"} note={alert === "cancelled" ? "cancelled" : undefined} />
              <Step label="Location obtained" s={coords ? "done" : loc === "denied" || loc === "unsupported" || loc === "error" ? "failed" : "pending"} note={loc === "denied" ? "permission denied" : loc === "requesting" ? "requesting…" : undefined} />
              <Step label={`Trusted contacts notified (${contacts.length})`} s={notify ?? (contacts.length ? "pending" : "unavailable")} note={notify === "simulated" ? "simulated — not sent" : notify === "unavailable" ? "no provider configured" : !contacts.length ? "no contacts" : undefined} />
            </ul>
          </div>
        </section>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {/* System status */}
        <section className="panel p-5">
          <h3 className="mb-3 font-semibold">System status</h3>
          <ul className="space-y-2.5 text-sm">
            <Status label="Camera" value={rec.cam} ok={rec.cam === "on"} bad={["denied", "error", "unsupported"].includes(rec.cam)} />
            <Status label="AI recognition" value={rec.model === "ready" ? "ready (on-device)" : rec.model} ok={rec.model === "ready"} bad={rec.model === "error"} />
            <Status label="Location" value={loc} ok={loc === "granted"} bad={["denied", "error", "unsupported"].includes(loc)} />
            <Status label="Notifications" value={demo ? "demo (simulated)" : "provider not configured"} ok={false} bad={!demo} />
            <Status label="Last command" value={lastCmd} ok={false} bad={false} />
          </ul>
          {loc !== "granted" && (
            <button onClick={() => void requestLocation()} className="mt-4 w-full rounded-lg border border-accent/50 py-2 text-sm text-accent hover:bg-accent/10">Test location permission</button>
          )}
        </section>

        {/* Gesture test panel */}
        <section className="panel p-5">
          <h3 className="mb-1 font-semibold">Gesture test panel</h3>
          <p className="mb-3 text-xs text-muted-foreground">✓ marks gestures genuinely recognised by the camera this session. Buttons run the command manually.</p>
          <ul className="space-y-2">
            {GESTURES.map((g) => (
              <li key={g.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${rec.det.gesture === g.id ? "border-accent glow-cyan" : ""}`}>
                <span className="text-xl" aria-hidden>{g.emoji}</span>
                <div className="flex-1 text-sm">
                  <div className="font-medium">{g.label}</div>
                  <div className="text-xs text-muted-foreground">{g.commandLabel} · hold {g.holdMs / 1000}s</div>
                </div>
                <span className="w-12 text-right font-mono text-xs text-success">{seen[g.id] ? `✓ ${((seen[g.id] ?? 0) * 100).toFixed(0)}%` : ""}</span>
                <button onClick={() => run(g.command, "manual button")} className="rounded-md border px-2 py-1 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Run ${g.commandLabel} manually`}>Run</button>
              </li>
            ))}
          </ul>
        </section>

        {/* Contacts */}
        <ContactsPanel contacts={contacts} setContacts={setContacts} demo={demo} />
        <ServicesPanel settings={settings} setSettings={setSettings} demo={demo} onCall={(t) => add("action", demo ? `SIMULATED call to ${t.name} — no call made` : `Opened dialer for ${t.name} (${t.phone}) — call not verified`)} />
      </div>

      <EmergencyMode open={emergencyOpen} demo={demo} contacts={contacts} settings={settings} onLog={add}
        onClose={() => { setEmergencyOpen(false); cancelAlert("exit emergency mode"); }} />

      {/* Timeline */}
      <section className="panel mt-5 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Activity timeline</h3>
          <button onClick={() => setLog([])} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
        </div>
        <ol className="max-h-72 space-y-1.5 overflow-y-auto font-mono text-xs" aria-live="polite">
          {log.map((l) => (
            <li key={l.id} className="flex gap-3">
              <span className="shrink-0 text-muted-foreground">{l.t.toLocaleTimeString()}</span>
              <span className={`shrink-0 w-14 uppercase ${l.kind === "warn" ? "text-primary" : l.kind === "detect" ? "text-accent" : l.kind === "action" ? "text-success" : "text-muted-foreground"}`}>{l.kind}</span>
              <span>{l.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="mt-6 text-center text-xs text-muted-foreground">
        Video is processed in your browser and never uploaded or saved. GestureGuard is a prototype — not a replacement for emergency services.
      </footer>
    </div>
  );
}

function ContactsPanel({ contacts, setContacts, demo }: { contacts: Contact[]; setContacts: (c: Contact[]) => void; demo: boolean }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState<ContactLabel>("Mom");
  const [editing, setEditing] = useState<string | null>(null);
  const valid = name.trim() && /^\+?[0-9 ()-]{3,}$/.test(phone.trim());
  const full = !editing && contacts.length >= MAX_CONTACTS;
  const clear = () => { setName(""); setPhone(""); setLabel("Mom"); setEditing(null); };
  const save = () => {
    if (!valid || full) return;
    if (editing) setContacts(contacts.map((c) => (c.id === editing ? { ...c, name: name.trim(), phone: phone.trim(), label } : c)));
    else setContacts([...contacts, { id: crypto.randomUUID(), name: name.trim(), phone: phone.trim(), label, primary: contacts.length === 0 }]);
    clear();
  };
  return (
    <section className="panel p-5">
      <h3 className="mb-1 font-semibold">Emergency contacts <span className="font-mono text-xs text-muted-foreground">{contacts.length}/{MAX_CONTACTS}</span></h3>
      <p className="mb-3 text-xs text-muted-foreground">Saved only in this browser on this device — never uploaded. The ⭐ primary contact is used for "call my emergency contact".</p>
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-2">
        <input aria-label="Contact name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full rounded-md border bg-input/30 px-3 py-2 text-sm outline-none focus:border-ring" />
        <div className="flex gap-2">
          <input aria-label="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" inputMode="tel" className="min-w-0 flex-1 rounded-md border bg-input/30 px-3 py-2 text-sm outline-none focus:border-ring" />
          <select aria-label="Relationship" value={label} onChange={(e) => setLabel(e.target.value as ContactLabel)} className="rounded-md border bg-card px-2 py-2 text-sm">
            {CONTACT_LABELS.map((l) => <option key={l}>{l}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <button disabled={!valid || full} className="flex-1 rounded-md bg-secondary py-2 text-sm font-medium hover:bg-muted disabled:opacity-40">{editing ? "Save changes" : full ? "Maximum 5 contacts" : "Add contact"}</button>
          {editing && <button type="button" onClick={clear} className="rounded-md border px-3 text-sm">Cancel</button>}
        </div>
      </form>
      <ul className="mt-3 space-y-1.5 text-sm">
        {contacts.map((c) => (
          <li key={c.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5">
            <button onClick={() => setContacts(contacts.map((x) => ({ ...x, primary: x.id === c.id })))} className={c.primary ? "text-warning" : "text-muted-foreground/50 hover:text-warning"} aria-label={`Make ${c.name} primary`} title="Primary contact">★</button>
            <span className="min-w-0 flex-1 truncate">{c.name} <span className="text-xs text-accent">{c.label}</span> <span className="font-mono text-xs text-muted-foreground">{c.phone}</span></span>
            <button onClick={() => { setEditing(c.id); setName(c.name); setPhone(c.phone); setLabel(c.label); }} className="text-xs text-muted-foreground hover:text-foreground">Edit</button>
            <button onClick={() => { if (confirm(`Delete ${c.name}?`)) setContacts(contacts.filter((x) => x.id !== c.id)); }} className="text-xs text-muted-foreground hover:text-primary" aria-label={`Delete ${c.name}`}>Delete</button>
          </li>
        ))}
        {!contacts.length && <li className="text-xs text-muted-foreground">No contacts yet.</li>}
      </ul>
      {demo && !contacts.length && (
        <button onClick={() => setContacts([
          { id: "mock-1", name: "Test Mom", phone: "+91 00000 00001", label: "Mom", primary: true },
          { id: "mock-2", name: "Test Dad", phone: "+91 00000 00002", label: "Dad", primary: false },
          { id: "mock-3", name: "Test Friend", phone: "+91 00000 00003", label: "Friend", primary: false },
        ])} className="mt-3 w-full rounded-md border border-warning/50 py-2 text-xs text-warning hover:bg-warning/10">Add mock test contacts (fake numbers)</button>
      )}
    </section>
  );
}

function ServicesPanel({ settings, setSettings, demo, onCall }: { settings: ServiceSettings; setSettings: (s: ServiceSettings) => void; demo: boolean; onCall: (t: Target) => void }) {
  return (
    <section className="panel p-5">
      <h3 className="mb-1 font-semibold">Emergency services</h3>
      <p className="mb-3 text-xs text-muted-foreground">Region guessed from your device time zone — change it if wrong. In India, 112 reaches integrated emergency response.</p>
      <select aria-label="Region" value={settings.region} onChange={(e) => setSettings({ ...settings, region: e.target.value as Region })} className="mb-3 w-full rounded-md border bg-card px-3 py-2 text-sm">
        {(Object.keys(REGIONS) as Region[]).map((r) => <option key={r} value={r}>{REGIONS[r].name}</option>)}
      </select>
      <div className="space-y-2">{serviceTargets(settings).map((t) => <CallButton key={t.key} target={t} demo={demo} onCall={onCall} />)}</div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground">Set local ambulance / hospital numbers</summary>
        <div className="mt-2 space-y-2">
          <input aria-label="Local ambulance number" value={settings.ambulance} onChange={(e) => setSettings({ ...settings, ambulance: e.target.value })} placeholder={`Ambulance (default ${REGIONS[settings.region].ambulance})`} inputMode="tel" className="w-full rounded-md border bg-input/30 px-3 py-2 text-sm" />
          <input aria-label="Hospital name" value={settings.hospitalName} onChange={(e) => setSettings({ ...settings, hospitalName: e.target.value })} placeholder="Nearest hospital name" className="w-full rounded-md border bg-input/30 px-3 py-2 text-sm" />
          <input aria-label="Hospital phone" value={settings.hospitalPhone} onChange={(e) => setSettings({ ...settings, hospitalPhone: e.target.value })} placeholder="Hospital phone" inputMode="tel" className="w-full rounded-md border bg-input/30 px-3 py-2 text-sm" />
        </div>
      </details>
    </section>
  );
}

function Toggle({ label, on, onChange, tone = "accent" }: { label: string; on: boolean; onChange: (v: boolean) => void; tone?: "accent" | "warning" | "primary" }) {
  const bg = on ? (tone === "warning" ? "bg-warning" : tone === "primary" ? "bg-primary" : "bg-accent") : "bg-muted";
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-ring">
      <span className={`relative h-4 w-7 rounded-full transition ${bg}`}><span className={`absolute top-0.5 h-3 w-3 rounded-full bg-foreground transition-all ${on ? "left-3.5" : "left-0.5"}`} /></span>
      {label}: <strong>{on ? "On" : "Off"}</strong>
    </button>
  );
}

function StatusBlock({ tone, title, desc }: { tone: "success" | "muted"; title: string; desc: string }) {
  return (
    <div className="mt-3 flex items-center gap-3">
      <span className={`h-3.5 w-3.5 rounded-full ${tone === "success" ? "bg-success pulse-dot" : "bg-muted-foreground"}`} />
      <div><h2 className="text-2xl font-bold">{title}</h2><p className="text-sm text-muted-foreground">{desc}</p></div>
    </div>
  );
}

function Step({ label, s, note }: { label: string; s: StepState; note?: string | undefined }) {
  const map = { done: ["✓", "text-success"], pending: ["○", "text-muted-foreground"], unavailable: ["–", "text-muted-foreground"], simulated: ["◇", "text-warning"], failed: ["✕", "text-primary"] } as const;
  const [icon, cls] = map[s];
  return (
    <li className="flex items-center gap-2">
      <span className={`w-4 font-mono font-bold ${cls}`} aria-hidden>{icon}</span>
      <span className="flex-1">{label}</span>
      <span className={`text-xs ${cls}`}>{note ?? s}</span>
    </li>
  );
}

function Status({ label, value, ok, bad }: { label: string; value: string; ok: boolean; bad: boolean }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 font-mono text-xs">
        <span className={`h-2 w-2 rounded-full ${ok ? "bg-success" : bad ? "bg-primary" : "bg-warning"}`} />{value}
      </span>
    </li>
  );
}

function Overlay({ text }: { text: string }) {
  return <div className="absolute inset-0 grid place-items-center bg-background/60 text-sm text-accent"><span className="pulse-dot">{text}</span></div>;
}
