/**
 * WCAG contrast ratio validation for theme color safety.
 *
 * Prevents users from setting custom colors that make the UI unreadable
 * (e.g., white text on white background). Uses the WCAG 2.0 relative
 * luminance formula to calculate contrast ratios.
 *
 * Minimum threshold: 3.0:1 (WCAG AA for large text / UI components).
 * Full AA for body text is 4.5:1, but 3.0 is sufficient for the
 * large text sizes and short labels used in Wave's UI.
 */

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.substring(0, 2), 16),
    parseInt(clean.substring(2, 4), 16),
    parseInt(clean.substring(4, 6), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Minimum contrast ratio for readability (WCAG AA large text) */
const MIN_CONTRAST = 3.0;

/**
 * Color pairs that must maintain readable contrast.
 * Each pair is [foreground_key, background_key].
 * When the user changes one color, we check all pairs that include it.
 */
const CONTRAST_PAIRS: [string, string][] = [
  ["text", "bg"],
  ["text", "surface"],
  ["muted", "bg"],
  ["muted", "surface"],
  ["primary", "bg"],
  ["primary", "surface"],
  ["accent", "bg"],
  ["wave", "bg"],
  ["match", "bg"],
  ["danger", "bg"],
];

/**
 * Validate that a proposed color change maintains readable contrast
 * with all paired colors. Returns null if valid, or an error message
 * describing which pair fails.
 */
export function validateColorContrast(
  changingKey: string,
  newValue: string,
  currentColors: Record<string, string>,
): string | null {
  for (const [fgKey, bgKey] of CONTRAST_PAIRS) {
    const isFg = changingKey === fgKey;
    const isBg = changingKey === bgKey;
    if (!isFg && !isBg) continue;

    const fg = isFg ? newValue : currentColors[fgKey];
    const bg = isBg ? newValue : currentColors[bgKey];
    if (!fg || !bg) continue;

    const ratio = contrastRatio(fg, bg);
    if (ratio < MIN_CONTRAST) {
      return `Too similar to ${isFg ? bgKey : fgKey} (contrast ${ratio.toFixed(1)}:1, need ${MIN_CONTRAST}:1)`;
    }
  }

  return null;
}
