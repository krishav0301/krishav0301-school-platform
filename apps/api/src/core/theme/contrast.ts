/**
 * Colour contrast by the WCAG 2.2 formula. Used to refuse a theme whose text cannot be read.
 * https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
 */

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** [r, g, b] as 0 to 255, or null if the text is not #rgb or #rrggbb. */
export function parseHex(hex: string): [number, number, number] | null {
  if (!HEX.test(hex)) return null;
  const digits = hex.slice(1);
  const full = digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

/** 0 (black) to 1 (white), with the colours linearised as the standard requires. */
export function relativeLuminance(rgb: readonly [number, number, number]): number {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 1 (identical) to 21 (black on white). Throws on a colour it cannot read. */
export function contrastRatio(foreground: string, background: string): number {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  if (!fg || !bg) throw new Error(`Not a colour: ${!fg ? foreground : background}`);
  const [lighter, darker] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}
