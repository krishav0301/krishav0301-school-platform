import { env } from "cloudflare:test";

import { createApp } from "../src/app";
import { signAccessToken, type RoleClaim } from "../src/core/tokens";
import { createUser } from "../src/modules/accounts/service";

export const db = env.DB;
export const auditKey = env.AUDIT_HMAC_KEY;
export const app = createApp();
const password = "blue-river-lamp-2083";

/** The two sections the tests use. Safe to call in every file: it only adds what is missing. */
export async function seedSections(): Promise<void> {
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO sections (key, name, ordering) VALUES ('plus2', '+2', 0)"),
    db.prepare("INSERT OR IGNORE INTO sections (key, name, ordering) VALUES ('bachelors', 'Bachelor''s', 1)"),
  ]);
}

export interface Person {
  publicId: string;
  cookie: string;
}

let n = 0;
/** A real account with one role assignment, and a signed sign-in cookie for it (as the browser would hold). */
export async function person(role: string, scope: string, section?: string): Promise<Person> {
  const email = `${role}-${++n}-${crypto.randomUUID().slice(0, 6)}@school.example`;
  const { publicId } = await createUser(db, auditKey, {
    email,
    password,
    fullName: `${role} person`,
    roles: [{ role: role as never, scope: scope as never, ...(section ? { sectionKey: section } : {}) }],
  });
  const claim = { role, scope, ...(section ? { section } : {}) } as RoleClaim;
  const now = Math.floor(Date.now() / 1000);
  const token = await signAccessToken(env.SESSION_SECRET, { sub: publicId, sid: "s", name: "Person", roles: [claim], iat: now, exp: now + 600 });
  return { publicId, cookie: `__Host-access=${token}` };
}

export const call = (path: string, init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) =>
  app.request(
    `https://school.example${path}`,
    {
      method: init.method ?? "GET",
      headers: {
        "Sec-Fetch-Site": "same-origin",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(init.cookie ? { Cookie: init.cookie } : {}),
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    },
    env,
  );

export const count = async (sql: string, ...params: (string | number)[]): Promise<number> =>
  (await db.prepare(sql).bind(...params).first<{ n: number }>())!.n;

export const auditActions = async (entityPublicId: string): Promise<string[]> =>
  (await db.prepare("SELECT action FROM audit_events WHERE entity_public_id = ?1 ORDER BY id").bind(entityPublicId).all<{ action: string }>()).results.map((r) => r.action);

let theProgrammesAdmin: Promise<Person> | undefined;
/** The Admin who makes programmes and levels in a test file (D-087: no Co-ordinator may). One per file. */
export const programmesAdmin = (): Promise<Person> => (theProgrammesAdmin ??= person("admin", "institution"));
