/**
 * Recovery codes: ten single-use codes that let someone sign in if they lose their phone. Shown
 * once when two-step sign-in is turned on; stored only as SHA-256 hashes (each code has about 50
 * random bits, and using one is rate-limited, so a plain hash is enough).
 */
import { sha256Hex } from "../tokens";

// No 0, 1, i, l or o, which look alike when read off a page.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const HALF = 5;

export function newRecoveryCodes(count = 10): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const bytes = crypto.getRandomValues(new Uint8Array(HALF * 2));
    const letters = [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join("");
    codes.add(`${letters.slice(0, HALF)}-${letters.slice(HALF)}`);
  }
  return [...codes];
}

/** The code without capitals, spaces or the dash; null if it is not the right shape. */
export function normaliseRecoveryCode(input: string): string | null {
  const squashed = input.toLowerCase().replace(/[\s-]+/g, "");
  return new RegExp(`^[${ALPHABET}]{${HALF * 2}}$`).test(squashed) ? squashed : null;
}

/** What is stored for a code. Throws if the text cannot be a recovery code. */
export async function hashRecoveryCode(input: string): Promise<string> {
  const normal = normaliseRecoveryCode(input);
  if (!normal) throw new Error("Not a recovery code.");
  return sha256Hex(`recovery:${normal}`);
}
