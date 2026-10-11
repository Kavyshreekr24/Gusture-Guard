export type Command = "emergency" | "confirm" | "cancel" | "location" | "reset";

export interface GestureDef {
  id: string; // MediaPipe category name
  label: string;
  emoji: string;
  command: Command;
  commandLabel: string;
  holdMs: number;
}

export const GESTURES: GestureDef[] = [
  { id: "Open_Palm", label: "Open Palm", emoji: "✋", command: "emergency", commandLabel: "Emergency", holdMs: 1500 },
  { id: "Thumb_Up", label: "Thumbs Up", emoji: "👍", command: "confirm", commandLabel: "Confirm alert", holdMs: 600 },
  { id: "Closed_Fist", label: "Closed Fist", emoji: "✊", command: "cancel", commandLabel: "Cancel alert", holdMs: 600 },
  { id: "Victory", label: "Peace Sign", emoji: "✌️", command: "location", commandLabel: "Location status", holdMs: 600 },
  { id: "Pointing_Up", label: "Pointing Up", emoji: "☝️", command: "reset", commandLabel: "Ready / Reset", holdMs: 600 },
];

export const GESTURE_BY_ID = Object.fromEntries(GESTURES.map((g) => [g.id, g])) as Record<string, GestureDef>;

export const CONFIDENCE_THRESHOLD = 0.65;
export const COOLDOWN_MS = 1500;
export const COUNTDOWN_S = 10;
