/**
 * Tokens for sign-in sessions (D-021).
 *
 * The access token is a short-lived, signed statement of who the user is and which roles they
 * hold. Checking it needs no database read. It lasts 30 minutes: every renewal is a database
 * write, and the free plan allows 100,000 writes a day. Because it can be up to 30 minutes stale
 * after a role change or deactivation, money, approval and publish actions re-check the user's
 * assignments inside their own batch and never trust the token alone.
 *
 * The refresh token is random. Only its SHA-256 hash is stored, so a copy of the database cannot
 * be used to sign in.
 */
import { constantTimeEqual, fromBase64Url, toBase64Url } from "./encoding";

export const ACCESS_TTL_SECONDS = 30 * 60;
const TOKEN_VERSION = 1;

export interface RoleClaim {
  role: string;
  scope: "own" | "assigned" | "section" | "institution";
  /** Section key, for section scope. */
  section?: string;
}

export interface AccessClaims {
  /** The user's public id. */
  sub: string;
  /** The session's public id. */
  sid: string;
  name: string;
  roles: RoleClaim[];
  /** Seconds since 1970. */
  iat: number;
  exp: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signAccessToken(secret: string, claims: AccessClaims): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify({ v: TOKEN_VERSION, ...claims })));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/** The claims, or null for anything that is not a valid, unexpired token signed with `secret`. */
export async function verifyAccessToken(
  secret: string,
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<AccessClaims | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

    const signature = fromBase64Url(parts[1]);
    // crypto.subtle.verify compares in constant time.
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), signature, encoder.encode(parts[0]));
    if (!valid) return null;

    const body = JSON.parse(decoder.decode(fromBase64Url(parts[0]))) as Record<string, unknown>;
    if (body.v !== TOKEN_VERSION) return null;
    const { v: _version, ...claims } = body;

    const c = claims as unknown as AccessClaims;
    const wellFormed =
      typeof c.sub === "string" && typeof c.sid === "string" && typeof c.name === "string" &&
      Array.isArray(c.roles) && typeof c.iat === "number" && typeof c.exp === "number";
    if (!wellFormed || c.exp <= nowSeconds) return null;
    return c;
  } catch {
    return null;
  }
}

/** 32 random bytes, URL-safe. Goes in the user's cookie. */
export function newRefreshToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export { constantTimeEqual };
