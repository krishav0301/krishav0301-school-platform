import { themeToCss } from "./css";
import { DEFAULT_THEME } from "./default-theme";

export const THEME_STYLE_ID = "school-theme";
export const THEME_CACHE_KEY = "school.theme.css.v1";
export const CONFIG_CACHE_KEY = "school.config.v1";

/** The CSS of the built-in default theme, written into every page at build time. */
export const DEFAULT_THEME_CSS = themeToCss(DEFAULT_THEME);

/**
 * Runs in the page head, before the first paint: if this browser has seen the school's theme
 * before, apply it at once, so a returning visitor never sees the default colours flash. The very
 * first visit shows the neutral default for a moment until the theme arrives. Kept tiny, and wrapped
 * in try/catch because storage can be blocked.
 */
export const THEME_BOOT_SCRIPT = `try{var c=localStorage.getItem(${JSON.stringify(THEME_CACHE_KEY)});var s=document.getElementById(${JSON.stringify(THEME_STYLE_ID)});if(c&&s)s.textContent=c}catch(e){}`;

/** Puts a theme's CSS on the page (and remembers it for the next visit). `null` restores the default. */
export function applyThemeCss(css: string | null): void {
  const style = document.getElementById(THEME_STYLE_ID);
  if (style) style.textContent = css ?? DEFAULT_THEME_CSS;
  try {
    if (css) localStorage.setItem(THEME_CACHE_KEY, css);
    else localStorage.removeItem(THEME_CACHE_KEY);
  } catch {
    /* storage blocked: the theme still applies for this visit */
  }
}
