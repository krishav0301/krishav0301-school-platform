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
import { scrypt } from "@noble/hashes/scrypt.js";

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

/** True only for the right password. Never throws on a bad stored value. */
export function verifyPassword(password: string, stored: string): boolean {
  const parsed = parse(stored);
  if (!parsed) return false;
  const key = scrypt(normalise(password), parsed.salt, { N: parsed.n, r: parsed.r, p: parsed.p, dkLen: KEY_LENGTH });
  return constantTimeEqual(key, parsed.key);
}

/** True when the stored hash was made with weaker settings than today's. */
export function needsRehash(stored: string): boolean {
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
