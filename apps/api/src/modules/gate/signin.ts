import { newPublicId } from "../../core/ids";
import { hashPassword, verifyPassword } from "../../core/passwords";
import { verifyTotp } from "../../core/two-factor/totp";
import { openSecret } from "./accounts";
import { hashKey, newDeviceKey } from "./keys";

export const GATE_FAILURE_LIMIT = 5;
export const GATE_IP_FAILURE_LIMIT = 30;
const WINDOW_MINUTES = 15;
const MINUTE = 60_000;

export interface GateSignInInput {
  gateId: unknown;
  password: unknown;
  code: unknown;
  /** What the person calls this computer; the browser's description is used if they give none. */
  computer?: unknown;
  ip: string | null;
  userAgent: string | null;
}

export type GateSignInResult =
  | { ok: true; key: string; account: string; computer: { id: string; label: string } }
  | { ok: false; reason: "invalid_credentials" | "throttled" };

let dummyHash: string | undefined;

/**
 * A computer signs in to the gate with the account's special ID, its password and a code from its authenticator app
 * (D-176), and is given a secret key that it holds from then on. Any number of computers can sign in with one account.
 *
 * It is guarded like the staff sign-in: five failures an ID in fifteen minutes, or thirty an address, and a throttled
 * attempt writes nothing and does no hashing; wrong ID, wrong password and wrong code all answer the same, and a wrong ID
 * is checked against a made-up hash so it takes as long as a right one; a code works once, claimed with a conditional
 * update, so a code seen over a shoulder cannot be used again and two computers cannot both use it.
 */
export async function signInGate(db: D1Database, dataKey: string, input: GateSignInInput, now = new Date()): Promise<GateSignInResult> {
  const gateId = typeof input.gateId === "string" ? input.gateId.trim().toLowerCase().slice(0, 40) : "";
  const password = typeof input.password === "string" ? input.password.slice(0, 200) : "";
  const code = typeof input.code === "string" ? input.code.slice(0, 20) : "";
  const tried = `gate:${gateId}`;
  const since = new Date(now.getTime() - WINDOW_MINUTES * MINUTE).toISOString();
  const userAgent = input.userAgent?.slice(0, 300) ?? null;

  const [account, byId, byIp] = await db.batch([
    db.prepare("SELECT id, public_id, user_id, name, password_hash, secret_sealed, last_used_step, status FROM gate_accounts WHERE gate_id = ?1").bind(gateId),
    db.prepare("SELECT COUNT(*) AS n FROM sign_in_events WHERE success = 0 AND email_tried = ?1 AND at > ?2").bind(tried, since),
    db.prepare("SELECT COUNT(*) AS n FROM sign_in_events WHERE success = 0 AND ip = ?1 AND at > ?2").bind(input.ip ?? "", since),
  ]);
  if ((byId!.results[0] as { n: number }).n >= GATE_FAILURE_LIMIT || (input.ip && (byIp!.results[0] as { n: number }).n >= GATE_IP_FAILURE_LIMIT)) return { ok: false, reason: "throttled" };

  const row = account!.results[0] as { id: number; public_id: string; user_id: number; name: string; password_hash: string; secret_sealed: string; last_used_step: number; status: string } | undefined;
  const usable = row !== undefined && row.status === "active";
  // Both checks always run, so the answer and the time do not say which was wrong.
  const passwordOk = usable ? verifyPassword(password, row.password_hash) : (verifyPassword(password, (dummyHash ??= hashPassword("this-is-not-a-gate-password"))), false);
  const secret = usable ? await openSecret(dataKey, row.public_id, row.secret_sealed) : null;
  const step = secret ? verifyTotp(secret, code, now.getTime()) : null;
  const fresh = step !== null && usable && step > row.last_used_step;

  const event = (success: boolean, reason: string | null) =>
    db
      .prepare("INSERT INTO sign_in_events (at, user_id, email_tried, success, reason, ip, user_agent) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
      .bind(now.toISOString(), row?.user_id ?? null, tried.slice(0, 254), success ? 1 : 0, reason, input.ip, userAgent);

  if (!usable || !passwordOk || !fresh) {
    await event(false, !row ? "unknown_gate" : !usable ? "inactive" : !passwordOk ? "bad_password" : step === null ? "bad_code" : "code_reused").run();
    return { ok: false, reason: "invalid_credentials" };
  }

  const key = newDeviceKey();
  const label = (typeof input.computer === "string" ? input.computer.trim() : "").slice(0, 120) || userAgent?.slice(0, 120) || "Computer";
  const computerId = newPublicId();
  const [claimed, made] = await db.batch([
    // Spends the code. If another sign-in spent this step first, this changes nothing and nothing below is written.
    db.prepare("UPDATE gate_accounts SET last_used_step = ?2 WHERE id = ?1 AND last_used_step < ?2 AND status = 'active'").bind(row.id, step),
    db
      .prepare("INSERT INTO gate_devices (public_id, account_id, label, key_hash, created_at) SELECT ?1, ?2, ?3, ?4, ?5 WHERE changes() > 0")
      .bind(computerId, row.id, label, await hashKey(key), now.toISOString()),
    db
      .prepare("INSERT INTO sign_in_events (at, user_id, email_tried, success, reason, ip, user_agent) SELECT ?1, ?2, ?3, 1, NULL, ?4, ?5 WHERE changes() > 0")
      .bind(now.toISOString(), row.user_id, tried.slice(0, 254), input.ip, userAgent),
  ]);
  if ((claimed!.meta.changes ?? 0) === 0 || (made!.meta.changes ?? 0) === 0) return { ok: false, reason: "invalid_credentials" };
  return { ok: true, key, account: row.name, computer: { id: computerId, label } };
}
