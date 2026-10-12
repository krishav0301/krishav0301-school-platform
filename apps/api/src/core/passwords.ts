/**
 * Password hashing and rules (D-019, D-021).
 *
 * scrypt, N=2^15, r=8, p=1, through @noble/hashes. The Workers runtime caps PBKDF2 at 100,000
 * rounds, which is much weaker, so PBKDF2 is not used. About 0.3 to 0.5 s per hash on the free
 * plan (spike: docs/spikes/cloudflare-test.md). N=2^17 exceeds the Worker's memory.
 *
 * Stored form: scrypt$N$r$p$salt$hash, so parameters can be raised later and old hashes upgraded
 * at the next sign-in (`needsRehash`).
 */
import { hmac } from "@noble/hashes/hmac.js";
import { scrypt } from "@noble/hashes/scrypt.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { constantTimeEqual, fromBase64Url, toBase64Url } from "./encoding";

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

// A stored hash is data from the database. Refuse costs far above ours, so a tampered row cannot
// be used to burn the Worker's CPU or memory.
const MIN_N = 2 ** 10;
const MAX_N = 2 ** 16;

const MIN_LENGTH = 10;
const MAX_LENGTH = 128;

/** Visually identical text (for example a composed and a decomposed é) is the same password. */
const normalise = (password: string): string => password.normalize("NFKC");

export function hashPassword(password: string): string {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = scrypt(normalise(password), salt, { N, r: R, p: P, dkLen: KEY_LENGTH });
  return `scrypt$${N}$${R}$${P}$${toBase64Url(salt)}$${toBase64Url(key)}`;
}

interface Parsed {
  n: number;
  r: number;
  p: number;
  salt: Uint8Array;
  key: Uint8Array;
}

function parse(stored: string): Parsed | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])] as [number, number, number];
  const isPowerOfTwo = Number.isInteger(n) && n >= MIN_N && n <= MAX_N && (n & (n - 1)) === 0;
  if (!isPowerOfTwo || !Number.isInteger(r) || r < 1 || r > 8 || !Number.isInteger(p) || p < 1 || p > 4) return null;
  try {
    const salt = fromBase64Url(parts[4]!);
    const key = fromBase64Url(parts[5]!);
    if (salt.length < 16 || key.length !== KEY_LENGTH) return null;
    return { n, r, p, salt, key };
  } catch {
    return null;
  }
}

// --- A student's 4-digit password (D-164) -----------------------------------------------------------------------------
//
// scrypt takes about a third of a second of processing, more than one request may use on the free plan, so making or
// checking a student's password failed at random ("Worker exceeded resource limits"). A 4-digit password has only 10,000
// possibilities, so no hash makes it hard to guess if someone holds the stored value; what protects it is that the stored
// value alone is not enough, and the lockout. So it is stored as an HMAC-SHA256 with a per-password salt and a key held by
// the server (a secret, never in the database): light to compute, and useless to anyone who copies only the database.

const PIN_PREFIX = "pin1$";
const encoder = new TextEncoder();

/** The key for 4-digit passwords: made from a server secret, and different from every other use of that secret. */
const pinKey = (secret: string): Uint8Array => hmac(sha256, encoder.encode(secret), encoder.encode("student-pin-v1"));

const pinMac = (password: string, salt: Uint8Array, secret: string): Uint8Array => {
  const text = encoder.encode(normalise(password));
  const message = new Uint8Array(salt.length + text.length);
  message.set(salt, 0);
  message.set(text, salt.length);
  return hmac(sha256, pinKey(secret), message);
};

/** True for a value made by `hashPin`. */
export const isPinHash = (stored: string): boolean => stored.startsWith(PIN_PREFIX);

/** The light hash for a student's 4-digit password: `pin1$salt$mac`. */
export function hashPin(password: string, secret: string): string {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  return `${PIN_PREFIX}${toBase64Url(salt)}$${toBase64Url(pinMac(password, salt, secret))}`;
}

function verifyPin(password: string, stored: string, secret: string | undefined): boolean {
  if (!secret) return false;
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  try {
    const salt = fromBase64Url(parts[1]!);
    const mac = fromBase64Url(parts[2]!);
    if (salt.length < 8 || mac.length !== 32) return false;
    return constantTimeEqual(pinMac(password, salt, secret), mac);
  } catch {
    return false;
  }
}

/**
 * True only for the right password. Never throws on a bad stored value. A 4-digit password's light hash needs the server's
 * secret to be checked (`pinSecret`); without it that kind of value never matches.
 */
export function verifyPassword(password: string, stored: string, pinSecret?: string): boolean {
  if (isPinHash(stored)) return verifyPin(password, stored, pinSecret);
  const parsed = parse(stored);
  if (!parsed) return false;
  const key = scrypt(normalise(password), parsed.salt, { N: parsed.n, r: parsed.r, p: parsed.p, dkLen: KEY_LENGTH });
  return constantTimeEqual(key, parsed.key);
}

/** True when the stored hash was made with weaker settings than today's. */
export function needsRehash(stored: string): boolean {
  if (isPinHash(stored)) return false; // the light hash is the chosen one for a 4-digit password, not a weaker version of the strong one
  const parsed = parse(stored);
  return !parsed || parsed.n < N || parsed.r < R || parsed.p < P;
}

export type PasswordProblem = "too_short" | "too_long" | "common" | "contains_email" | "contains_school_name";

// A small list of the passwords people choose most. It names no school (D-008): a school's own name is
// refused separately, from its configuration (`schoolNameWords`). `OPEN:` a fuller breached-password check.
const COMMON = new Set([
  "password", "password1", "password12", "password123", "password1234", "passw0rd123", "12345678",
  "123456789", "1234567890", "12345678910", "qwertyuiop", "qwerty12345", "1q2w3e4r5t", "iloveyou12",
  "admin12345", "admin123456", "welcome123", "letmein123", "changeme123", "nepal12345", "nepal123456",
  "kathmandu123", "school12345", "student1234", "teacher1234",
  "abcdefghij", "abc1234567", "0123456789",
]);

// Words too common in school names to say anything about a particular school.
const GENERIC_SCHOOL_WORDS = new Set(["school", "college", "campus", "institute", "academy", "higher", "secondary", "public", "boarding", "english", "national", "international", "memorial"]);

/** The distinctive words in a school's names: lower case, at least 4 letters, not a generic school word. */
export function schoolNameWords(names: readonly string[]): string[] {
  const words = new Set<string>();
  for (const name of names) {
    for (const word of name.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if ([...word].length >= 4 && !GENERIC_SCHOOL_WORDS.has(word)) words.add(word);
    }
  }
  return [...words];
}

/**
 * Empty means the password is acceptable. Length counts characters, not bytes. `avoidWords` are
 * words the password must not contain, such as the school's name (`schoolNameWords`).
 */
export function passwordProblems(password: string, email?: string, avoidWords: readonly string[] = []): PasswordProblem[] {
  const text = normalise(password);
  const length = [...text].length;
  const problems: PasswordProblem[] = [];

  if (length < MIN_LENGTH) problems.push("too_short");
  if (length > MAX_LENGTH) problems.push("too_long");
  if (COMMON.has(text.toLowerCase())) problems.push("common");

  const localPart = email?.split("@")[0]?.toLowerCase();
  if (localPart && localPart.length >= 4 && text.toLowerCase().includes(localPart)) problems.push("contains_email");

  // Punctuation and spaces are ignored, so "s.p.r.i.n.g" and "Spring Field" are both caught for a school with those words.
  const squashed = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (avoidWords.some((word) => word.length > 0 && squashed.includes(word))) problems.push("contains_school_name");

  return problems;
}
