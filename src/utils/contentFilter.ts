/**
 * Basic profanity filter for user-generated content (40-char notes).
 *
 * Uses word-boundary matching to avoid false positives on legitimate words
 * that contain blocked substrings (e.g., "glass" contains "ass").
 *
 * This is a best-effort client-side filter for Apple App Store compliance
 * (guideline 1.2). Determined attackers will find workarounds — the
 * block/report system handles those cases.
 */

// Compact word list: common English slurs, explicit terms, and hate speech.
// Kept intentionally short and focused. Lowercase, no duplicates.
const BLOCKED_WORDS = [
  // Profanity
  "fuck", "shit", "bitch", "asshole", "dick", "cock", "pussy",
  "cunt", "motherfucker", "fucker", "fucking", "bullshit",
  "bastard", "damn", "piss", "whore", "slut",
  // Slurs & hate speech
  "nigger", "nigga", "faggot", "fag", "retard", "retarded",
  "tranny", "dyke", "spic", "kike", "chink", "wetback", "gook",
  // Sexual
  "porn", "hentai", "dildo", "blowjob", "handjob",
  // Violence
  "kill yourself", "kys",
  // Common l33t/evasion variants
  "fck", "fuk", "phuck", "phuk", "sh1t", "b1tch", "d1ck",
  "a$$", "azz", "p$$y", "cnt",
];

// Build a Set for O(1) single-word lookups
const SINGLE_WORD_SET = new Set<string>();
const MULTI_WORD_PHRASES: string[] = [];

for (const word of BLOCKED_WORDS) {
  if (word.includes(" ")) {
    MULTI_WORD_PHRASES.push(word);
  } else {
    SINGLE_WORD_SET.add(word);
  }
}

/**
 * Check if text contains profanity or objectionable content.
 * Returns true if objectionable content is detected.
 */
export function containsProfanity(text: string): boolean {
  if (!text) return false;

  const lower = text.toLowerCase();

  // Check multi-word phrases first (e.g., "kill yourself")
  for (const phrase of MULTI_WORD_PHRASES) {
    if (lower.includes(phrase)) return true;
  }

  // Split into words and check each against the blocked set.
  // Word boundary approach: split on non-alphanumeric characters.
  const words = lower.split(/[^a-z0-9]+/);
  for (const word of words) {
    if (word && SINGLE_WORD_SET.has(word)) return true;
  }

  // Check for common evasion: letter substitution (l33tspeak)
  // Only check the most common substitutions for the worst slurs
  const normalized = lower
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/\$/g, "s")
    .replace(/@/g, "a");

  if (normalized !== lower) {
    const normalizedWords = normalized.split(/[^a-z0-9]+/);
    for (const word of normalizedWords) {
      if (word && SINGLE_WORD_SET.has(word)) return true;
    }
  }

  return false;
}
