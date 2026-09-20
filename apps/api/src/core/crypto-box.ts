/**
 * Sealed values: text encrypted with a Worker secret, for things that must be stored but must not
 * be readable from a copy of the database (a password-reset token waiting in the outbox, a
 * two-factor secret). AES-256-GCM through Web Crypto; nothing here is our own cryptography.
 *
 * Stored form: `v1.<iv>.<ciphertext>`, both base64url. The `purpose` is bound in as authenticated
 * data, so a value sealed for one use cannot be copied into another and opened there.
 */
import { fromBase64Url, toBase64Url } from "./encoding";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const VERSION = "v1";
const MIN_KEY_LENGTH = 32;

/** A 256-bit key from the secret. The secret is long and random, so a plain SHA-256 is enough. */
async function importKey(secret: string, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  if (secret.length < MIN_KEY_LENGTH) throw new Error(`The data encryption key must be at least ${MIN_KEY_LENGTH} characters.`);
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [usage]);
}

export async function seal(secret: string, plaintext: string, purpose: string): Promise<string> {
  const key = await importKey(secret, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(purpose) }, key, encoder.encode(plaintext));
  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

/** The original text, or null for a wrong key, wrong purpose, damaged value or anything else. */
export async function open(secret: string, sealed: string, purpose: string): Promise<string | null> {
  try {
    const parts = sealed.split(".");
    if (parts.length !== 3 || parts[0] !== VERSION) return null;
    const iv = fromBase64Url(parts[1]!);
    if (iv.length !== 12) return null;
    const key = await importKey(secret, "decrypt");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(purpose) }, key, fromBase64Url(parts[2]!));
    return decoder.decode(plain);
  } catch {
    return null;
  }
}
