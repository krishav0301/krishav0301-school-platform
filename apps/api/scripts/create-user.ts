import { getPlatformProxy } from "wrangler";

import { createUser, WeakPasswordError, type RoleInput } from "../src/modules/accounts/service";
import { schoolNameWords } from "../src/core/passwords";
import { ROLES, SCOPES, type Role, type Scope } from "../src/core/roles";

/**
 * Creates a user in the LOCAL development database, through the same service the screens will use
 * (so the audit entry is written too). The password comes from the USER_PASSWORD environment
 * variable, never from the command line, so it does not end up in shell history.
 *
 *   $env:USER_PASSWORD = "a-long-passphrase"
 *   npm run dev:user -- --email sita@school.example --name "Sita Sharma" --role coordinator
 *   npm run dev:user -- --email ram@school.example --name "Ram" --role accountant --scope section:bachelors
 *
 * Scope defaults to the usual one for the role. Local database only: staging and production users
 * are created by their own process (Phase 1 slice 8 / Phase 10).
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
  const password = process.env.USER_PASSWORD;

  if (!email || !name || !role) throw new Error("Usage: --email <email> --name <full name> --role <role> [--scope institution|own|assigned|section:<key>]");
  if (!ROLES.includes(role)) throw new Error(`Unknown role "${role}". Roles: ${ROLES.join(", ")}`);
  if (!password) throw new Error("Set the USER_PASSWORD environment variable first.");

  const [scopeName, sectionKey] = (scopeArgument ?? DEFAULT_SCOPE[role]).split(":");
  const scope = scopeName as Scope;
  if (!SCOPES.includes(scope)) throw new Error(`Unknown scope "${scopeName}". Scopes: ${SCOPES.join(", ")}`);
  const assignment: RoleInput = { role, scope, ...(sectionKey ? { sectionKey } : {}) };

  const { env, dispose } = await getPlatformProxy<{ DB: D1Database; AUDIT_HMAC_KEY: string }>({ configPath: "wrangler.jsonc" });
  try {
    // A password built from the school's own name is refused, like on the sign-up and reset screens.
    const school = await env.DB.prepare("SELECT name, short_name FROM school WHERE id = 1").first<{ name: string; short_name: string }>();
    const avoidWords = school ? schoolNameWords([school.name, school.short_name]) : [];
    const { publicId } = await createUser(env.DB, env.AUDIT_HMAC_KEY, { email, password, fullName: name, roles: [assignment], avoidWords });
    console.warn(`Created ${role} ${email} (${publicId}) in the local database.`);
  } finally {
    await dispose();
  }
}

main().catch((error) => {
  console.error(error instanceof WeakPasswordError ? `Password not acceptable: ${error.problems.join(", ")}` : error instanceof Error ? error.message : error);
  process.exit(1);
});
