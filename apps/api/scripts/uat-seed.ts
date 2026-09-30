import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

import { signAccessToken } from "../src/core/tokens";
import { seedUat, type Actor, type Call } from "./uat/seed";
import { wranglerD1 } from "./wrangler-d1";

/**
 * Loads the UAT starter set (D-086) into a deployed test site, through that site's own API, as the screens would.
 *
 *   $env:SESSION_SECRET = "<the deployment's session secret>"
 *   npm run uat:seed -- --url https://school-platform-staging.example.workers.dev --config wrangler.local.jsonc
 *
 * It acts as the deployment's existing Admin, Co-ordinator and Accountant (by default admin@, coordinator@ and
 * accountant@school.example; change with --admin, --coordinator, --accountant), found in its database through
 * `--config`. It signs short-lived access tokens for them with the session secret, which only the operator holds.
 *
 * It refuses any site where email is really sent, so it can never run against production (the dev email adapter is
 * refused there). The new people's temporary passwords go to a file OUTSIDE the repository (by default
 * ~/.school-platform/uat-accounts-<tag>.txt), never to the screen or to git; each must choose their own password at
 * first sign-in.
 */
function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const url = argument("url")?.replace(/\/+$/, "");
  const config = argument("config");
  const secret = process.env.SESSION_SECRET ?? "";
  if (!url || !config) throw new Error("Usage: npm run uat:seed -- --url <the test site's address> --config <its wrangler config, such as wrangler.local.jsonc>");
  if (secret.length < 32) throw new Error("Set SESSION_SECRET to the deployment's session secret first.");
  const origin = new URL(url).origin;

  const tag = new Date().toISOString().slice(0, 16).replace(/\D/g, "").slice(2);
  const out = resolve(argument("out") ?? join(homedir(), ".school-platform", `uat-accounts-${tag}.txt`));
  const repo = resolve(import.meta.dirname, "../../..");
  if (!relative(repo, out).startsWith("..")) throw new Error(`Refusing to write passwords inside the repository (${out}). Choose a file outside it.`);

  const emails: Record<Actor, string> = {
    admin: argument("admin") ?? "admin@school.example",
    coordinator: argument("coordinator") ?? "coordinator@school.example",
    accountant: argument("accountant") ?? "accountant@school.example",
  };
  const db = wranglerD1({ target: "--remote", config });
  const cookies = {} as Record<Actor, string>;
  for (const role of Object.keys(emails) as Actor[]) {
    const user = await db
      .prepare("SELECT u.public_id, u.full_name FROM users u JOIN role_assignments ra ON ra.user_id = u.id WHERE u.email = ?1 AND u.is_active = 1 AND ra.is_active = 1 AND ra.role = ?2 AND ra.scope_type = 'institution'")
      .bind(emails[role], role)
      .first<{ public_id: string; full_name: string }>();
    if (!user) throw new Error(`No active whole-school ${role} ${emails[role]} on that deployment.`);
    const now = Math.floor(Date.now() / 1000);
    cookies[role] = `__Host-access=${await signAccessToken(secret, { sub: user.public_id, sid: "uat-seed", name: user.full_name, roles: [{ role, scope: "institution" }], iat: now, exp: now + 1800 })}`;
  }

  const call: Call = (method, path, actor, body) =>
    fetch(`${origin}${path}`, {
      method,
      headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", Cookie: cookies[actor], ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  // Only a site whose email is kept, not sent: never production.
  const mailbox = await call("GET", "/api/dev/mailbox", "admin");
  if (mailbox.status !== 200) throw new Error(`Refusing: ${origin} really sends email (test mailbox answered ${mailbox.status}), so it is not a test site.`);

  const result = await seedUat(call, { tag });
  const lines = [
    `UAT starter set for ${origin}, year ${result.yearLabel}, made ${new Date().toISOString()}.`,
    "Each person must choose their own password at first sign-in. Keep this file private.",
    "",
    ...result.accounts.map((a) => [a.role, a.name, a.email, a.temporaryPassword, a.sid ?? "", a.className ?? ""].join(" | ")),
  ];
  writeFileSync(out, `${lines.join("\n")}\n`, { encoding: "utf8", flag: "wx" });
  console.warn(`Made ${result.classes.map((c) => c.name).join(" and ")}, ${result.accounts.filter((a) => a.role === "teacher").length} teachers and ${result.accounts.filter((a) => a.role === "student").length} students.`);
  console.warn(`Their sign-ins are in ${out} (not shown here).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
