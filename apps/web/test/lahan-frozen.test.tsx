import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ScrollHomeView, type ScrollSite } from "@/site/scroll/ScrollHome";
import lahanJson from "../../../packs/lahan-manakamana/pack.json";
import { siteFrom } from "./site-fixture";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

/**
 * Lahan Manakamana is live and frozen (PM, 2026-10-13, D-170). Its code changes only when the PM asks for it by name.
 * One build serves every school, so this test fingerprints what decides how Lahan looks and behaves: its pack, its
 * photos, the one-page layout's code, and the page it renders. A change for another school that reaches Lahan breaks
 * this test. If the PM asked for the Lahan change, refresh the fingerprint with:
 *   UPDATE_LAHAN_FREEZE=1 npx vitest run test/lahan-frozen.test.tsx
 * and say so in the commit and in DECISIONS.md. Never refresh it to make an unrelated change pass.
 */
const root = join(import.meta.dirname, "..", "..", "..");
const manifestPath = join(import.meta.dirname, "fixtures", "lahan-frozen.json");

const WATCHED = [
  "packs/lahan-manakamana",
  "apps/web/src/site/scroll",
  "apps/web/public/site/lahan",
  "apps/api/src/modules/site/favicon.ts",
];
const TEXT = /\.(ts|tsx|json|css|md)$/;

function* walk(path: string): Generator<string> {
  if (statSync(path).isFile()) return yield path;
  for (const name of readdirSync(path).sort()) yield* walk(join(path, name));
}

const fingerprint = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const entry of WATCHED) {
    for (const file of walk(join(root, entry))) {
      const bytes = readFileSync(file);
      // Text is compared without line-ending differences, so Windows and Linux agree.
      const data = TEXT.test(file) ? Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n")) : bytes;
      out[relative(root, file).split("\\").join("/")] = createHash("sha256").update(data).digest("hex");
    }
  }
  const site = siteFrom(lahanJson as never) as ScrollSite;
  const slots = { classes: <p>C</p>, notices: <p>N</p>, admission: <p>A</p>, about: <p>B</p> };
  for (const signedIn of [false, true]) {
    const html = renderToStaticMarkup(<ScrollHomeView schoolName={lahanJson.school.name} site={site} signedIn={signedIn} slots={slots} />);
    out[`rendered page, signed ${signedIn ? "in" : "out"}`] = createHash("sha256").update(html).digest("hex");
  }
  return out;
};

describe("Lahan Manakamana is frozen", () => {
  it("has the same pack, photos, layout code and page as when it went live, unless the PM asked for a Lahan change", () => {
    const now = fingerprint();
    if (process.env.UPDATE_LAHAN_FREEZE === "1") {
      writeFileSync(manifestPath, `${JSON.stringify(now, null, 2)}\n`);
      return;
    }
    expect(existsSync(manifestPath), "fixtures/lahan-frozen.json is missing").toBe(true);
    const frozen = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, string>;
    const changed = [...new Set([...Object.keys(now), ...Object.keys(frozen)])].filter((key) => now[key] !== frozen[key]);
    expect(changed, "These Lahan files changed. Lahan changes only when the PM asks (D-170). If they did, refresh with UPDATE_LAHAN_FREEZE=1.").toEqual([]);
  });
});
