/**
 * The short-lived token that sits between "the password was right" and "the second step is done".
 * It names the person and what the next step is (`verify` an existing code, or `setup` a new
 * authenticator), and is signed with the session secret. It is not a session: by itself it opens
 * nothing except the two-step endpoints, and it expires in five minutes.
 */
import { fromBase64Url, toBase64Url } from "../encoding";

export const CHALLENGE_TTL_SECONDS = 5 * 60;
const PURPOSE = "two-factor-challenge";

export interface Challenge {
  /** The user's public id. */
  sub: string;
  /** `verify` and `setup` are the authenticator steps; `password` is choosing a new password after a temporary one (D-059). */
  kind: "verify" | "setup" | "password";
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const key = (secret: string, usage: "sign" | "verify") => crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);

export async function signChallenge(secret: string, challenge: Challenge, nowSeconds: number = Math.floor(Date.now() / 1000)): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify({ p: PURPOSE, sub: challenge.sub, kind: challenge.kind, exp: nowSeconds + CHALLENGE_TTL_SECONDS })));
  const signature = await crypto.subtle.sign("HMAC", await key(secret, "sign"), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/** The challenge, or null for anything that is not a valid, unexpired challenge signed with `secret`. */
export async function verifyChallenge(secret: string, token: string, nowSeconds: number = Math.floor(Date.now() / 1000)): Promise<Challenge | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const valid = await crypto.subtle.verify("HMAC", await key(secret, "verify"), fromBase64Url(parts[1]), encoder.encode(parts[0]));
    if (!valid) return null;

    const body = JSON.parse(decoder.decode(fromBase64Url(parts[0]))) as Record<string, unknown>;
    if (body.p !== PURPOSE || typeof body.sub !== "string" || typeof body.exp !== "number" || body.exp <= nowSeconds) return null;
    if (body.kind !== "verify" && body.kind !== "setup" && body.kind !== "password") return null;
    return { sub: body.sub, kind: body.kind };
  } catch {
    return null;
  }
}
