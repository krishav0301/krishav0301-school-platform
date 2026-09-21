import { getPlatformProxy } from "wrangler";

import { nepalDate } from "../src/core/dates";
import { createContent, publishContent } from "../src/modules/content/service";
import type { ContentInput } from "../src/modules/content/schema";

/**
 * Puts SAMPLE website content in the LOCAL development database, through the same service the Admin
 * screens use (so the audit log is written and the same rules apply). It is fake text for looking at the
 * public notice board: every kind, an urgent one, one that has ended, one not yet started, and a draft
 * (the last three must NOT show on the public board). It never touches a deployed database.
 *
 *   npm run dev:content -- --email admin@school.example
 *
 * The person named must already be an Admin (`npm run dev:user`). Run it once; it refuses if content
 * already exists, unless you add `--again`.
 */
function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** An AD day by Nepal's clock, `offset` days from today. */
function day(offset: number): string {
  const base = new Date(`${nepalDate(new Date())}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offset);
  return base.toISOString().slice(0, 10);
}

const item = (over: Partial<ContentInput> & Pick<ContentInput, "kind" | "title" | "body">): ContentInput => ({
  contact: null,
  urgent: false,
  publishOn: day(0),
  hideAfter: null,
  ...over,
});

const SAMPLES: { input: ContentInput; publish: boolean }[] = [
  { input: item({ kind: "notice", title: "Sample: classes are closed tomorrow", body: "Classes are closed tomorrow because of the weather.\n\nThey start again the day after.", urgent: true }), publish: true },
  { input: item({ kind: "holiday", title: "Sample: festival break", body: "The school is closed for the festival break.", publishOn: day(-2), hideAfter: day(10) }), publish: true },
  { input: item({ kind: "routine", title: "Sample: exam routine", body: "The exam routine is at the office.\n\nEach class has its own days.", publishOn: day(-5) }), publish: true },
  { input: item({ kind: "vacancy", title: "Sample: teacher wanted (email)", body: "A Maths teacher is wanted for the higher classes.", contact: "jobs@school.example", publishOn: day(-3), hideAfter: day(20) }), publish: true },
  { input: item({ kind: "vacancy", title: "Sample: office helper wanted (phone)", body: "An office helper is wanted.", contact: "+977 985-1234567", publishOn: day(-4) }), publish: true },
  { input: item({ kind: "vacancy", title: "Sample: librarian wanted (plain text)", body: "A librarian is wanted.", contact: "Ask at the office", publishOn: day(-6) }), publish: true },
  { input: item({ kind: "post", title: "Sample: <b>science fair</b> results", body: "Text like <b>this</b> and <script>alert(1)</script> is shown as typed, never run.\n\nA second paragraph follows.", publishOn: day(-8) }), publish: true },
  { input: item({ kind: "notice", title: "Sample: an old notice (ended, hidden)", body: "This ended yesterday and must not show.", publishOn: day(-30), hideAfter: day(-1) }), publish: true },
  { input: item({ kind: "notice", title: "Sample: a future notice (not yet, hidden)", body: "This starts in five days and must not show yet.", publishOn: day(5) }), publish: true },
  { input: item({ kind: "notice", title: "Sample: a draft (hidden)", body: "Never published, so it must not show." }), publish: false },
];

async function main() {
  const email = argument("email");
  if (!email) throw new Error("Usage: npm run dev:content -- --email <an Admin's email> [--again]");

  const proxy = await getPlatformProxy<{ DB: D1Database; AUDIT_HMAC_KEY: string }>({ configPath: "wrangler.jsonc" });
  try {
    const { DB: db, AUDIT_HMAC_KEY: auditKey } = proxy.env;

    const actor = await db.prepare("SELECT public_id FROM users WHERE email = ?1").bind(email).first<{ public_id: string }>();
    if (!actor) throw new Error(`No user ${email} in the local database. Create an Admin with npm run dev:user first.`);

    const existing = (await db.prepare("SELECT COUNT(*) AS n FROM content_items").first<{ n: number }>())!.n;
    if (existing > 0 && !process.argv.includes("--again")) throw new Error(`The local database already has ${existing} content items. Add --again to add the samples anyway.`);

    let made = 0;
    for (const sample of SAMPLES) {
      const created = await createContent(db, auditKey, actor.public_id, sample.input);
      if (!created.ok) throw new Error(`Could not create "${sample.input.title}": ${created.reason}${"message" in created ? ` (${created.message})` : ""}`);
      if (sample.publish) {
        const published = await publishContent(db, auditKey, actor.public_id, created.publicId);
        if (!published.ok) throw new Error(`Could not publish "${sample.input.title}": ${published.reason}`);
      }
      made++;
    }
    console.warn(`Added ${made} sample items to the local database (${SAMPLES.filter((s) => s.publish).length} published). Open /notices to see them.`);
  } finally {
    await proxy.dispose();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
