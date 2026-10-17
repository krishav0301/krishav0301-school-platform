import { sha256Hex } from "../../core/tokens";

const base64Url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A computer's secret key: 256 random bits. The gate page keeps it; only a hash of it is stored. */
export const newDeviceKey = (): string => `gk_${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`;

/** The hash a key is stored as. The key itself is never stored. */
export const hashKey = (key: string): Promise<string> => sha256Hex(`gate-key:${key}`);

/** No 0, O, 1, I or L: what a person reads off a screen and types must not be ambiguous. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** `length` characters from the alphabet, without the bias of taking a byte modulo the alphabet's size. */
export function randomText(length: number): string {
  let out = "";
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < limit && out.length < length) out += ALPHABET[byte % ALPHABET.length];
    }
  }
  return out;
}

/** A gate account's password: three groups of four, "K7M2-Q4XP-9TNB" (about 60 bits), shown once. */
export const newGatePassword = (): string => `${randomText(4)}-${randomText(4)}-${randomText(4)}`;

/** A gate account's special ID, "gate-k7m2q4": easy to say and type, and not guessable from the school's name. */
export const newGateId = (): string => `gate-${randomText(6).toLowerCase()}`;

export interface GateDevice {
  /** The computer's own row. */
  id: number;
  /** The account's system user: who the attendance this computer marks is marked by. */
  userId: number;
  /** The account's name, for example "Main gate". */
  name: string;
  /** The computer's own label. */
  label: string;
}

/** The active computer a key belongs to, if its account is active too; otherwise null. */
export async function deviceByKey(db: D1Database, key: string): Promise<GateDevice | null> {
  if (!/^gk_[A-Za-z0-9_-]{20,80}$/.test(key)) return null;
  const row = await db
    .prepare(
      `SELECT d.id, a.user_id, a.name, d.label FROM gate_devices d JOIN gate_accounts a ON a.id = d.account_id
        WHERE d.key_hash = ?1 AND d.status = 'active' AND a.status = 'active'`,
    )
    .bind(await hashKey(key))
    .first<{ id: number; user_id: number; name: string; label: string }>();
  return row ? { id: row.id, userId: row.user_id, name: row.name, label: row.label } : null;
}
