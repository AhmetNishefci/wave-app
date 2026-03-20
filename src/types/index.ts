import i18n from "@/i18n";

export type Gender = "male" | "female";
export type GenderPreference = "male" | "female" | "both";

/** Map a single BLE gender character to a Gender value */
export function genderCharToGender(char: string): Gender | null {
  if (char === "M") return "male";
  if (char === "F") return "female";
  return null;
}

/** Map a Gender value to a single BLE gender character */
export function genderToChar(gender: Gender): string {
  return gender === "male" ? "M" : "F";
}

export interface NearbyPeer {
  deviceBleId: string;
  ephemeralToken: string;
  rssi: number;
  lastSeen: number;
  discoveredAt: number;
  gender: Gender | null;
  age: number | null;
  note: string | null;
  /** Resolved user ID from server. Set by useNoteResolver after token lookup. */
  userId: string | null;
}

export type DistanceZone = "HERE" | "CLOSE" | "NEARBY";

/**
 * RSSI thresholds for distance zones:
 * HERE:   >= -55 dBm  (~1-3 meters)
 * CLOSE:  >= -75 dBm  (~3-10 meters)
 * NEARBY: < -75 dBm   (~10-30 meters)
 */
export function getDistanceZone(rssi: number): DistanceZone {
  if (rssi >= -55) return "HERE";
  if (rssi >= -75) return "CLOSE";
  return "NEARBY";
}

/** Human-readable signal strength label (quality indicator, not distance) */
export function getSignalLabel(rssi: number): string {
  if (rssi >= -45) return i18n.t("signal.strong");
  if (rssi >= -60) return i18n.t("signal.good");
  if (rssi >= -75) return i18n.t("signal.fair");
  return i18n.t("signal.weak");
}

export interface WavePending {
  targetToken: string;
  sentAt: number;
}

export interface Match {
  matchId: string;
  matchedUserId: string;
  instagramHandle?: string;
  snapchatHandle?: string;
  createdAt: string;
  seen: boolean;
}

/** Contact handles for a matched peer (used in radar detail modal) */
export interface ContactHandles {
  instagram?: string;
  snapchat?: string;
}

export type BlePermissionStatus = "unknown" | "granted" | "denied" | "blocked";

export type WaveResult = "pending" | "match" | "already_matched" | "rate_limited" | "blocked" | "error";

export type BleAdapterState =
  | "Unknown"
  | "Resetting"
  | "Unsupported"
  | "Unauthorized"
  | "PoweredOff"
  | "PoweredOn";

// ── Anonymous avatar generation ──────────────────────────────────────────────

const AVATAR_EMOJIS = [
  "🦊", "🐙", "🦋", "🐬", "🦉", "🐺", "🦁", "🐼",
  "🦄", "🐸", "🦎", "🐝", "🦈", "🐨", "🦩", "🐯",
  "🦢", "🐳", "🦌", "🐍", "🦜", "🐆", "🦚", "🐧",
];

const AVATAR_COLORS = [
  { bg: "bg-violet-500/20", text: "text-violet-400", ring: "border-violet-500/40" },
  { bg: "bg-cyan-500/20", text: "text-cyan-400", ring: "border-cyan-500/40" },
  { bg: "bg-amber-500/20", text: "text-amber-400", ring: "border-amber-500/40" },
  { bg: "bg-rose-500/20", text: "text-rose-400", ring: "border-rose-500/40" },
  { bg: "bg-emerald-500/20", text: "text-emerald-400", ring: "border-emerald-500/40" },
  { bg: "bg-blue-500/20", text: "text-blue-400", ring: "border-blue-500/40" },
  { bg: "bg-pink-500/20", text: "text-pink-400", ring: "border-pink-500/40" },
  { bg: "bg-teal-500/20", text: "text-teal-400", ring: "border-teal-500/40" },
];

/** Simple hash from token string → number for deterministic avatar selection */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export interface PeerAvatar {
  emoji: string;
  bg: string;
  text: string;
  ring: string;
}

/** Generate a deterministic anonymous avatar from an ephemeral token */
export function getAvatarForToken(token: string): PeerAvatar {
  const hash = simpleHash(token);
  const emoji = AVATAR_EMOJIS[hash % AVATAR_EMOJIS.length];
  const color = AVATAR_COLORS[(hash >> 4) % AVATAR_COLORS.length];
  return { emoji, ...color };
}

/** Get time-ago label for peer freshness */
export function getTimeSince(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}
