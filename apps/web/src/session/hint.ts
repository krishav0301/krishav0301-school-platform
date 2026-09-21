/**
 * The session hint (see `core/session-cookies.ts` in the API): a cookie the server sets at sign-in and clears
 * at sign-out, meaning only "there may be a session". The real cookies are hidden from page scripts, so
 * this is how a page knows whether asking the server who is signed in is worth two requests. It grants
 * nothing and is safe if stale or forged: the page asks once, is told no, and the server clears it.
 */
export const SESSION_HINT = "__Host-signed-in";

/** True if the cookie string (`document.cookie`) carries the hint. */
export function hasSessionHint(cookies: string): boolean {
  return cookies.split(";").some((part) => part.trim() === `${SESSION_HINT}=1`);
}
