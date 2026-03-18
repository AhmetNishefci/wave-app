import type { Gender } from "@/types";
import { genderCharToGender } from "@/types";

export interface BlePayload {
  token: string;
  gender: Gender | null;
  age: number | null;
}

/**
 * Parse a raw BLE payload string into token + gender + age.
 *
 * Supported formats (after any prefix is stripped):
 *   19 chars: "{gender}{age2digits}{16-hex-token}"  (e.g. "M23abc123def456a7b8")
 *   17 chars: "{gender}{16-hex-token}"               (e.g. "Mabc123def456a7b8")
 *   16 chars: "{16-hex-token}"                        (legacy, no gender/age)
 */
export function parseBlePayload(raw: string): BlePayload | null {
  // Full format: gender char + 2-digit age + 16 hex chars
  if (raw.length === 19) {
    const gender = genderCharToGender(raw[0]);
    const ageStr = raw.slice(1, 3);
    const token = raw.slice(3).toLowerCase();
    if (/^\d{2}$/.test(ageStr) && /^[0-9a-f]{16}$/.test(token)) {
      return { token, gender, age: parseInt(ageStr, 10) };
    }
  }

  // Gender-only format: gender char + 16 hex chars
  if (raw.length === 17) {
    const gender = genderCharToGender(raw[0]);
    const token = raw.slice(1).toLowerCase(); // Case-insensitive (M11 fix)
    if (/^[0-9a-f]{16}$/.test(token)) {
      return { token, gender, age: null };
    }
  }

  // Legacy format: 16 hex chars (no gender/age)
  const lower = raw.toLowerCase(); // Case-insensitive (M11 fix)
  if (lower.length === 16 && /^[0-9a-f]{16}$/.test(lower)) {
    return { token: lower, gender: null, age: null };
  }

  return null;
}
