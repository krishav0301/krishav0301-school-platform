import { signAccessToken } from "../../../../apps/api/src/core/tokens";

const [sub, name, role, scope, sectionKey] = process.argv.slice(2);
const now = Math.floor(Date.now() / 1000);
const secret = /SESSION_SECRET=(.*)/.exec(await import("node:fs").then((fs) => fs.readFileSync(new URL("../../../../apps/api/.dev.vars", import.meta.url), "utf8")))![1]!.trim();
const assignment = scope === "section" ? { role, scope, sectionKey } : { role, scope: scope || "institution" };
console.log(await signAccessToken(secret, { sub: sub!, sid: "fut-prep", name: name!, roles: [assignment as never], iat: now, exp: now + 1800 }));
