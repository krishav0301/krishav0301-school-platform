import { getPlatformProxy } from "wrangler";

import { createUser, WeakPasswordError, type RoleInput } from "../src/modules/accounts/service";
import { schoolNameWords } from "../src/core/passwords";
import { ROLES, SCOPES, type Role, type Scope } from "../src/core/roles";
import { wranglerD1 } from "./wrangler-d1";

/**
 * Creates a user through the same service the screens use, so the audit entry is written too and
 * the same checks apply. Secrets come from the environment, never from the command line, so they do
 * not end up in shell history.
 *
 * Local development database (default):
 *   $env:USER_PASSWORD = "a-long-passphrase"
 *   npm run dev:user -- --email sita@school.example --name "Sita Sharma" --role coordinator
 *   npm run dev:user -- --email ram@school.example --name "Ram" --role accountant --scope section:bachelors
 *
 * A DEPLOYED database (staging, or a school's own): this is how the first Super Admin is made.
 * It also needs the deployment's audit key, because the audit log is keyed and its secret lives only
 * in the Worker and with whoever operates it.
 *   $env:USER_PASSWORD = "..."; $env:AUDIT_HMAC_KEY = "..."
 *   npm run dev:user -- --remote --config wrangler.local.jsonc --email you@school.example --name "Support" --role super_admin
 *
 * Scope defaults to the usual one for the role. A Super Admin is asked to set up their authenticator
 * app at their first sign-in.
 */
const DEFAULT_SCOPE: Record<Role, Scope> = {
  student: "own",
  teacher: "assigned",
  coordinator: "institution",
  accountant: "institution",
  admin: "institution",
  super_admin: "institution",
};

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const email = argument("email");
  const name = argument("name");
  const role = argument("role") as Role | undefined;
  const scopeArgument = argument("scope");
  const remote = process.argv.includes("--remote");
  const password = process.env.USER_PASSWORD;

  if (!email || !name || !role) throw new Error("Usage: --email <email> --name <full name> --role <role> [--scope institution|own|assigned|section:<key>] [--remote --config <file>]");
  if (!ROLES.includes(role)) throw new Error(`Unknown role "${role}". Roles: ${ROLES.join(", ")}`);
  if (!password) throw new Error("Set the USER_PASSWORD environment variable first.");

  const [scopeName, sectionKey] = (scopeArgument ?? DEFAULT_SCOPE[role]).split(":");
  const scope = scopeName as Scope;
  if (!SCOPES.includes(scope)) throw new Error(`Unknown scope "${scopeName}". Scopes: ${SCOPES.join(", ")}`);
  const assignment: RoleInput = { role, scope, ...(sectionKey ? { sectionKey } : {}) };

  let db: D1Database;
  let auditKey: string;
  let dispose = async () => {};

  if (remote) {
    const config = argument("config");
    if (!config) throw new Error("--remote needs --config <wrangler config for that deployment>, such as wrangler.local.jsonc.");
    auditKey = process.env.AUDIT_HMAC_KEY ?? "";
    if (auditKey.length < 32) throw new Error("Set AUDIT_HMAC_KEY to the deployment's audit key (at least 32 characters) first.");
    db = wranglerD1({ target: "--remote", config });
  } else {
    const proxy = await getPlatformProxy<{ DB: D1Database; AUDIT_HMAC_KEY: string }>({ configPath: "wrangler.jsonc" });
    db = proxy.env.DB;
    auditKey = proxy.env.AUDIT_HMAC_KEY;
    dispose = proxy.dispose;
  }

  try {
    // A password built from the school's own name is refused, like on the sign-up and reset screens.
    const school = await db.prepare("SELECT name, short_name FROM school WHERE id = 1").first<{ name: string; short_name: string }>();
    const avoidWords = school ? schoolNameWords([school.name, school.short_name]) : [];
    const { publicId } = await createUser(db, auditKey, { email, password, fullName: name, roles: [assignment], avoidWords });
    console.warn(`Created ${role} ${email} (${publicId}) in the ${remote ? "deployed" : "local"} database.`);
  } finally {
    await dispose();
  }
}

main().catch((error) => {
  console.error(error instanceof WeakPasswordError ? `Password not acceptable: ${error.problems.join(", ")}` : error instanceof Error ? error.message : error);
  process.exit(1);
});
