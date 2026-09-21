import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { ACCESS_TTL_SECONDS } from "./tokens";
import type { AppEnv } from "./types";

/** Absolute lifetime of a sign-in, and how long it may sit unused. */
export const SESSION_DAYS = 30;
export const IDLE_DAYS = 7;

// `__Host-` cookies are only accepted over HTTPS, for the exact host, with Path=/ and no Domain.
// So a sibling subdomain can never set or read them. HttpOnly keeps them from page scripts.
const BASE = { prefix: "host", path: "/", secure: true, httpOnly: true, sameSite: "Lax" } as const;

/**
 * The session hint: a cookie that says only "there may be a session", and nothing else. The real
 * cookies are hidden from page scripts, so a signed-out visitor's page cannot tell whether asking the
 * server who they are is worth a request; without this it always asks, and both requests (who am I,
 * then renew) fail. The hint is readable by the page for exactly that reason. The server never looks
 * at it, it grants nothing, and it is safe if forged or stale (the page then asks once, is told no, and
 * the server clears it). Every place a session is issued or ended goes through the two functions below.
 */
export const SESSION_HINT_COOKIE = "signed-in";

export function setSessionCookies(c: Context<AppEnv>, accessToken: string, refreshToken: string): void {
  setCookie(c, "access", accessToken, { ...BASE, maxAge: ACCESS_TTL_SECONDS });
  setCookie(c, "refresh", refreshToken, { ...BASE, maxAge: SESSION_DAYS * 24 * 60 * 60 });
  setCookie(c, SESSION_HINT_COOKIE, "1", { ...BASE, httpOnly: false, maxAge: SESSION_DAYS * 24 * 60 * 60 });
}

export function clearSessionCookies(c: Context<AppEnv>): void {
  deleteCookie(c, "access", { prefix: "host", path: "/", secure: true });
  deleteCookie(c, "refresh", { prefix: "host", path: "/", secure: true });
  deleteCookie(c, SESSION_HINT_COOKIE, { prefix: "host", path: "/", secure: true });
}

export const readAccessCookie = (c: Context<AppEnv>): string | undefined => getCookie(c, "access", "host");
export const readRefreshCookie = (c: Context<AppEnv>): string | undefined => getCookie(c, "refresh", "host");
