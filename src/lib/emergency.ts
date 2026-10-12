export type ContactLabel = "Mom" | "Dad" | "Friend" | "Emergency Contact" | "Doctor" | "Other";
export const CONTACT_LABELS: ContactLabel[] = ["Mom", "Dad", "Friend", "Emergency Contact", "Doctor", "Other"];
export const MAX_CONTACTS = 5;

export interface Contact { id: string; name: string; phone: string; label: ContactLabel; primary: boolean }

export type Region = "IN" | "US" | "UK" | "EU" | "AU";
export const REGIONS: Record<Region, { name: string; police: string; ambulance: string; fire: string; general: string }> = {
  IN: { name: "India", general: "112", police: "112", ambulance: "108", fire: "101" },
  US: { name: "United States / Canada", general: "911", police: "911", ambulance: "911", fire: "911" },
  UK: { name: "United Kingdom", general: "999", police: "999", ambulance: "999", fire: "999" },
  EU: { name: "Europe (112)", general: "112", police: "112", ambulance: "112", fire: "112" },
  AU: { name: "Australia", general: "000", police: "000", ambulance: "000", fire: "000" },
};

/** Best guess from the device time zone — a proxy, not GPS. User can change it. */
export function guessRegion(): Region {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    if (/Kolkata|Calcutta/.test(tz)) return "IN";
    if (tz.startsWith("America/")) return "US";
    if (tz === "Europe/London") return "UK";
    if (tz.startsWith("Australia/")) return "AU";
    if (tz.startsWith("Europe/")) return "EU";
  } catch {}
  return "IN";
}

export interface ServiceSettings { region: Region; ambulance: string; hospitalName: string; hospitalPhone: string }

export interface Target { kind: "service" | "contact"; key: string; title: string; name: string; phone: string; icon: string }

export function serviceTargets(s: ServiceSettings): Target[] {
  const r = REGIONS[s.region];
  const list: Target[] = [
    { kind: "service", key: "police", title: "Police", name: `Police · ${r.name}`, phone: r.police, icon: "🚓" },
    { kind: "service", key: "ambulance", title: "Ambulance", name: s.ambulance ? "Ambulance (your local number)" : `Ambulance · ${r.name}`, phone: s.ambulance || r.ambulance, icon: "🚑" },
    { kind: "service", key: "fire", title: "Fire & Rescue", name: `Fire & Rescue · ${r.name}`, phone: r.fire, icon: "🚒" },
  ];
  if (s.hospitalPhone) list.push({ kind: "service", key: "hospital", title: "Hospital", name: s.hospitalName || "Local hospital", phone: s.hospitalPhone, icon: "🏥" });
  return list;
}

export const contactIcon = (l: ContactLabel) => ({ Mom: "👩", Dad: "👨", Friend: "🤝", "Emergency Contact": "⭐", Doctor: "🩺", Other: "👤" })[l];
export const contactTarget = (c: Contact): Target => ({ kind: "contact", key: c.id, title: c.label === "Other" ? c.name : c.label, name: c.name, phone: c.phone, icon: contactIcon(c.label) });

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

const LABEL_PATTERNS: [ContactLabel, RegExp][] = [
  ["Emergency Contact", /\b(emergency contact|primary contact|trusted contact|my contact)\b/],
  ["Mom", /\b(mom|mommy|mum|mummy|mother|amma|maa|mama)\b/],
  ["Dad", /\b(dad|daddy|father|papa|appa|pappa)\b/],
  ["Friend", /\b(friend|buddy|bestie|best friend)\b/],
  ["Doctor", /\b(doctor|doc|physician|gp)\b/],
];
const SERVICE_PATTERNS: [string, RegExp][] = [
  ["fire", /\b(fire|burning|smoke|flames?|rescue|fire brigade)\b/],
  ["ambulance", /\b(ambulance|medical|hospital|injur\w*|hurt|bleeding|heart attack|accident|unconscious|faint\w*|can'?t breathe|breathing|sick)\b/],
  ["police", /\b(police|cops?|thief|robbery|robbed|stolen|attack\w*|harass\w*|stalk\w*|unsafe|danger|kidnap\w*)\b/],
];

export type MatchResult = { type: "found"; target: Target; heard: string } | { type: "missing"; label: string; heard: string } | { type: "none"; heard: string };

/** Map spoken text (with recogniser alternatives) to a saved contact or emergency service. */
export function matchIntent(alternatives: string[], contacts: Contact[], settings: ServiceSettings): MatchResult {
  const services = serviceTargets(settings);
  let missing: MatchResult | null = null;
  for (const raw of alternatives) {
    const t = raw.toLowerCase().replace(/[.,!?]/g, " ");
    // 1. a saved contact's name ("call Priya")
    const byName = contacts.find((c) => c.name.trim().length >= 2 && c.name.toLowerCase().split(/\s+/).some((w) => w.length >= 2 && new RegExp(`\\b${w.replace(/[^a-z0-9]/g, "")}\\b`).test(t)));
    if (byName) return { type: "found", target: contactTarget(byName), heard: raw };
    // 2. a relationship label ("call my mother")
    for (const [label, re] of LABEL_PATTERNS) {
      if (!re.test(t)) continue;
      const c = label === "Emergency Contact"
        ? contacts.find((x) => x.primary) ?? contacts.find((x) => x.label === "Emergency Contact")
        : contacts.find((x) => x.label === label);
      if (c) return { type: "found", target: contactTarget(c), heard: raw };
      if (label === "Doctor") { const h = services.find((s) => s.key === "hospital"); if (h) return { type: "found", target: h, heard: raw }; }
      missing ??= { type: "missing", label, heard: raw };
    }
    // 3. an emergency service ("I need medical help")
    for (const [key, re] of SERVICE_PATTERNS) {
      if (re.test(t)) return { type: "found", target: services.find((s) => s.key === key)!, heard: raw };
    }
  }
  return missing ?? { type: "none", heard: alternatives[0] ?? "" };
}
