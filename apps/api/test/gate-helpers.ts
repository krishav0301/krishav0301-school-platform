import { env } from "cloudflare:test";
import * as OTPAuth from "otpauth";

import { signInGate, type GateSignInInput, type GateSignInResult } from "../src/modules/gate/signin";
import { call, type Person } from "./academics-helpers";

/** A gate account as the Admin is shown it, once: its special ID, password and authenticator's setup key. */
export interface Account {
  id: string;
  name: string;
  gateId: string;
  password: string;
  secret: string;
}

/** The code an authenticator app would show at a moment. */
export const codeAt = (secret: string, atMs: number): string =>
  new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30, algorithm: "SHA1" }).generate({ timestamp: atMs });

/** The Admin makes a gate account through the real route. */
export async function makeAccount(admin: Person, name: string): Promise<Account> {
  const response = await call("/api/gate/accounts", { method: "POST", cookie: admin.cookie, body: { name } });
  if (response.status !== 201) throw new Error(`could not make a gate account: ${response.status}`);
  const body = (await response.json()) as { id: string; name: string; gateId: string; password: string; authenticator: { secret: string } };
  return { id: body.id, name: body.name, gateId: body.gateId, password: body.password, secret: body.authenticator.secret };
}

let tick = 0;
const base = Date.now();

/**
 * Signs a computer in with the account's login. Each call is a later thirty-second step than the last, so every code is a
 * fresh one (a code works once), and the clock handed to the service is the one the code was made for.
 */
export async function signInComputer(account: Account, over: { computer?: string; input?: Partial<GateSignInInput>; step?: number } = {}): Promise<GateSignInResult & { at: Date }> {
  tick += (over.step ?? 1) * 30_000;
  const at = new Date(base + tick);
  const result = await signInGate(
    env.DB,
    env.DATA_KEY,
    { gateId: account.gateId, password: account.password, code: codeAt(account.secret, at.getTime()), computer: over.computer, ip: null, userAgent: null, ...over.input },
    at,
  );
  return { ...result, at };
}
