import { paletteToCss } from "./css";
import { PALETTES, SCHOOL_PALETTE } from "./palettes";

/**
 * A person's own colour palette for the portal (D-127). Kept in this browser, not the account: it is a look, not a
 * record, and changing it writes nothing on the server. The public site keeps the school's own colours.
 */
export const PALETTE_STYLE_ID = "personal-palette";
export const PALETTE_KEY = "school.palette.v1";
export const PALETTE_CSS_KEY = "school.palette.css.v1";

/** Fills the palette in before the first paint on a portal page, so a returning person never sees a flash. */
export const PALETTE_BOOT_SCRIPT = `try{if(location.pathname.indexOf("/portal")===0){var p=localStorage.getItem(${JSON.stringify(PALETTE_CSS_KEY)});var e=document.getElementById(${JSON.stringify(PALETTE_STYLE_ID)});if(p&&e)e.textContent=p}}catch(e){}`;

/** The CSS for a palette key, or null for the school's own colours (and for a key that no longer exists). */
export function paletteCss(key: string): string | null {
  const palette = PALETTES.find((p) => p.key === key);
  return palette ? paletteToCss(palette.colors) : null;
}

/** The chosen palette's key; the school's own colours when none was chosen or storage is blocked. */
export function readPalette(): string {
  try {
    const key = localStorage.getItem(PALETTE_KEY);
    return key && PALETTES.some((p) => p.key === key) ? key : SCHOOL_PALETTE;
  } catch {
    return SCHOOL_PALETTE;
  }
}

/** Shows a palette on the page now (null: none, the school's own colours). */
export function showPalette(key: string | null): void {
  const style = document.getElementById(PALETTE_STYLE_ID);
  if (style) style.textContent = key ? (paletteCss(key) ?? "") : "";
}

/** Chooses a palette: shows it and remembers it for this browser. */
export function choosePalette(key: string): void {
  showPalette(key);
  try {
    const css = paletteCss(key);
    if (css) {
      localStorage.setItem(PALETTE_KEY, key);
      localStorage.setItem(PALETTE_CSS_KEY, css);
    } else {
      localStorage.removeItem(PALETTE_KEY);
      localStorage.removeItem(PALETTE_CSS_KEY);
    }
  } catch {
    /* storage blocked: the palette still shows for this visit */
  }
}
