import { env } from "cloudflare:test";

import { createApp } from "../src/app";
import { signAccessToken, type RoleClaim } from "../src/core/tokens";
import { createUser } from "../src/modules/accounts/service";

export const db = env.DB;
export const auditKey = env.AUDIT_HMAC_KEY;
export const app = createApp(); // registers the real content approval handler as a side effect (D-061)
const password = "blue-river-lamp-2083";

export interface Person {
  publicId: string;
  cookie: string;
}

let n = 0;
export async function person(role: string, scope: string): Promise<Person> {
  const email = `${role}-${++n}-${crypto.randomUUID().slice(0, 6)}@school.example`;
  const { publicId } = await createUser(db, auditKey, { email, password, fullName: `${role} person`, roles: [{ role: role as never, scope: scope as never }] });
  const claim = { role, scope } as RoleClaim;
  const now = Math.floor(Date.now() / 1000);
  const token = await signAccessToken(env.SESSION_SECRET, { sub: publicId, sid: "s", name: "Person", roles: [claim], iat: now, exp: now + 600 });
  return { publicId, cookie: `__Host-access=${token}` };
}

export const call = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  app.request(
    `https://school.example${path}`,
    {
      method: init.method ?? "GET",
      headers: {
        "Sec-Fetch-Site": "same-origin",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(init.cookie ? { Cookie: init.cookie } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    },
    env,
  );

export const count = async (sql: string, ...params: (string | number)[]): Promise<number> =>
  (await db.prepare(sql).bind(...params).first<{ n: number }>())!.n;

export const auditActions = async (entityPublicId: string): Promise<string[]> =>
  (await db.prepare("SELECT action FROM audit_events WHERE entity_public_id = ?1 ORDER BY id").bind(entityPublicId).all<{ action: string }>()).results.map((r) => r.action);
