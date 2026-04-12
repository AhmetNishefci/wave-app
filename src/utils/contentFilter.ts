/**
 * Profanity filter for user-generated content (40-char notes).
 *
 * Covers all 7 supported languages: EN, DE, FR, ES, IT, PT, TR.
 *
 * Uses word-boundary matching with Unicode-aware splitting to avoid
 * false positives on legitimate words that contain blocked substrings
 * (e.g., "glass" contains "ass", "therapist" contains "rape").
 *
 * This is a best-effort client-side filter for Apple App Store compliance
 * (guideline 1.2). Determined attackers will find workarounds — the
 * block/report system handles those cases.
 */

// ─── Word Lists ────────────────────────────────────────────────
// Each list targets the same threshold: unambiguous profanity, slurs,
// explicit sexual terms, and hate speech. Mild everyday swears that
// are borderline (e.g., "damn") are included to match App Store
// expectations. Words that are normal in another supported language
// are excluded to prevent cross-language false positives:
//   - "bite" (FR slang) excluded — normal English word
//   - "con" (FR vulgar) excluded — means "with" in ES/IT
//   - "got" excluded as normalization of "göt" — normal English word
//   - "figa" (IT) excluded — could be a surname

const EN_BLOCKED = [
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

const DE_BLOCKED = [
  // Profanity
  "scheiße", "scheisse", "scheiß", "scheiss",
  "arschloch", "arsch",
  "fick", "ficken", "ficker", "verfickt",
  "wichser", "wichsen",
  "fotze",
  "miststück", "miststueck",
  "drecksau", "dreckig",
  // Slurs
  "hurensohn", "hure",
  "schwuchtel",
  "missgeburt",
  "spasti", "spast",
  "behindert",
  // Violence
  "bring dich um",
];

const FR_BLOCKED = [
  // Profanity
  "merde",
  "putain",
  "connard", "connasse",
  "enculé", "encule", "enculer",
  "nique", "niquer", "nique ta mère", "nique ta mere", "ntm",
  "salope",
  "pute",
  "bordel",
  "foutre",
  "bâtard", "batard",
  // Slurs
  "pédé", "pede",
  "tapette",
  "gouine",
  // Sexual
  "baiser",
  // Violence
  "crève", "creve",
];

const ES_BLOCKED = [
  // Profanity
  "mierda",
  "puta", "puto",
  "pendejo", "pendeja",
  "cabrón", "cabron", "cabrona",
  "chingar", "chingada", "chingado",
  "verga",
  "coño", "cono",
  "joder", "jodido", "jodida",
  "culero", "culera",
  // Slurs
  "maricón", "maricon", "marica",
  // Multi-word
  "hijo de puta", "hijueputa",
  "la concha de tu madre",
  "malparido", "malparida",
];

const IT_BLOCKED = [
  // Profanity
  "cazzo",
  "merda",
  "stronzo", "stronza",
  "vaffanculo", "fanculo", "affanculo",
  "puttana",
  "troia",
  "minchia",
  "coglione", "coglioni",
  "bastardo", "bastarda",
  // Slurs
  "frocio",
  "ricchione",
  // Sexual
  "scopare",
];

const PT_BLOCKED = [
  // Profanity
  "porra",
  "caralho",
  "merda",
  "foda", "foder", "fodase",
  "puta", "filho da puta", "filha da puta",
  "buceta",
  "piranha",
  "arrombado", "arrombada",
  "corno", "corna",
  // Slurs
  "viado",
  "bicha",
  // Sexual
  "pau",
];

const TR_BLOCKED = [
  // Profanity
  "siktir", "siktirgit", "siktirin",
  "amk", "amına", "amina",
  "orospu", "orospu çocuğu", "orospu cocugu",
  "piç", "pic",
  "yarrak",
  "göt", "götveren",
  "sikeyim", "sik",
  "ananı", "anani",
  // Slurs
  "ibne",
  "pezevenk",
  "kahpe",
  // Multi-word
  "ananı sikeyim", "anani sikeyim",
];

// ─── Build lookup structures ───────────────────────────────────

const ALL_BLOCKED = [
  ...EN_BLOCKED,
  ...DE_BLOCKED,
  ...FR_BLOCKED,
  ...ES_BLOCKED,
  ...IT_BLOCKED,
  ...PT_BLOCKED,
  ...TR_BLOCKED,
];

const SINGLE_WORD_SET = new Set<string>();
const MULTI_WORD_PHRASES: string[] = [];

for (const word of ALL_BLOCKED) {
  if (word.includes(" ")) {
    MULTI_WORD_PHRASES.push(word);
  } else {
    SINGLE_WORD_SET.add(word);
  }
}

// ─── Accent normalization map ──────────────────────────────────
// Strips diacritics for evasion detection (second pass).
// Users may type "schéisse" or "fück" to dodge exact matches.

const ACCENT_MAP: Record<string, string> = {
  à: "a", á: "a", â: "a", ã: "a", ä: "a", å: "a",
  è: "e", é: "e", ê: "e", ë: "e",
  ì: "i", í: "i", î: "i", ï: "i", ı: "i",
  ò: "o", ó: "o", ô: "o", õ: "o", ö: "o",
  ù: "u", ú: "u", û: "u", ü: "u",
  ñ: "n",
  ç: "c",
  ş: "s", ß: "ss",
  ğ: "g",
  ý: "y", ÿ: "y",
};

function stripAccents(text: string): string {
  let result = "";
  for (const char of text) {
    result += ACCENT_MAP[char] ?? char;
  }
  return result;
}

// Build a second Set with accent-stripped versions of all blocked words.
// This catches evasion attempts like "fück" → "fuck", "götveren" → "gotveren".
const STRIPPED_SINGLE_WORD_SET = new Set<string>();
const STRIPPED_MULTI_WORD_PHRASES: string[] = [];

for (const word of ALL_BLOCKED) {
  const stripped = stripAccents(word);
  if (stripped.includes(" ")) {
    STRIPPED_MULTI_WORD_PHRASES.push(stripped);
  } else {
    STRIPPED_SINGLE_WORD_SET.add(stripped);
  }
}

// ─── Unicode-aware word splitting ──────────────────────────────
// The old regex [^a-z0-9]+ broke on accented characters (ü, ß, é, ñ,
// ç, ş, ı), splitting "scheiße" into "schei" + "e" and missing the
// match. This regex splits on any non-letter, non-number character
// using Unicode property escapes.

const WORD_SPLIT_RE = /[^\p{L}\p{N}]+/u;

// ─── Public API ────────────────────────────────────────────────

/**
 * Check if text contains profanity or objectionable content.
 * Returns true if objectionable content is detected.
 *
 * Three-pass approach:
 * 1. Exact match — checks lowercased text against all 7 language word lists
 * 2. Accent-stripped — catches evasion via diacritics ("fück" → "fuck")
 * 3. L33tspeak — catches digit/symbol substitution ("f1ck" → "fick")
 */
export function containsProfanity(text: string): boolean {
  if (!text) return false;

  const lower = text.toLowerCase();

  // ── Pass 1: Exact match (preserving accents) ──────────────
  // Check multi-word phrases first (e.g., "kill yourself", "hijo de puta")
  for (const phrase of MULTI_WORD_PHRASES) {
    if (lower.includes(phrase)) return true;
  }

  // Split into words and check each against the blocked set
  const words = lower.split(WORD_SPLIT_RE);
  for (const word of words) {
    if (word && SINGLE_WORD_SET.has(word)) return true;
  }

  // ── Pass 2: Accent-stripped ───────────────────────────────
  // Catches evasion like "fück" → "fuck", "sch3iße" stays "sch3isse"
  const stripped = stripAccents(lower);
  if (stripped !== lower) {
    for (const phrase of STRIPPED_MULTI_WORD_PHRASES) {
      if (stripped.includes(phrase)) return true;
    }
    const strippedWords = stripped.split(WORD_SPLIT_RE);
    for (const word of strippedWords) {
      if (word && STRIPPED_SINGLE_WORD_SET.has(word)) return true;
    }
  }

  // ── Pass 3: L33tspeak normalization ───────────────────────
  // Replaces common digit/symbol substitutions, then re-checks
  const normalized = stripped
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/\$/g, "s")
    .replace(/@/g, "a");

  if (normalized !== stripped) {
    for (const phrase of STRIPPED_MULTI_WORD_PHRASES) {
      if (normalized.includes(phrase)) return true;
    }
    const normalizedWords = normalized.split(WORD_SPLIT_RE);
    for (const word of normalizedWords) {
      if (word && STRIPPED_SINGLE_WORD_SET.has(word)) return true;
    }
  }

  return false;
}
