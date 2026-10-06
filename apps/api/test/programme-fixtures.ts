import { parsePack, type Pack } from "../src/core/config";
import { addLevel, createProgramme } from "../src/modules/academics/service";
import { createUser } from "../src/modules/accounts/service";

/**
 * A school starts with no programmes (D-087): the Admin makes them on the Programmes screen. Tests that need a
 * school's programmes make them the same way, through the services that screen calls, as an Admin. These are the
 * programmes, levels and grading policies the packs used to seed, kept here as test data, keyed by the pack's
 * `site.programmes` entry that gives each its name, section and affiliation.
 */
/** Each test programme's levels, and whether its exams are graded (letters) or a percentage, for its term's exam pattern (D-114). */
const LEVELS: Record<string, { levels: string[]; graded: boolean }> = {
  "plus2-sample": { levels: ["Grade 11", "Grade 12"], graded: true },
  "bachelors-sample": { levels: ["Year 1", "Year 2", "Year 3", "Year 4"], graded: false },
  "early-years": { levels: ["Nursery", "KG"], graded: false },
  primary: { levels: ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5"], graded: false },
  "lower-secondary": { levels: ["Grade 6", "Grade 7", "Grade 8"], graded: false },
  secondary: { levels: ["Grade 9", "Grade 10"], graded: false },
};

/**
 * A school's own pack lists no sections (D-095): the Admin makes them. Tests need a school with its sections already
 * there, keyed as its public programmes name them, so these are the sections the packs used to list, kept as test data.
 */
const SECTION_NAMES: Record<string, string> = { plus2: "+2", bachelors: "Bachelor's", school: "School" };

/** The pack, checked, with the sections its public programmes name added: what a test school starts from. */
export function testPack(input: unknown): Pack {
  const pack = parsePack(input);
  const keys = [...new Set(pack.site.programmes.map((p) => p.section))];
  return {
    ...pack,
    sections: keys.map((key) => {
      const name = SECTION_NAMES[key];
      if (!name) throw new Error(`No test section named for "${key}"`);
      return { key, name };
    }),
  };
}

/** Makes the pack's programmes, in its order, with their levels, as an Admin would. Returns the Admin. */
export async function seedProgrammes(db: D1Database, auditKey: string, pack: Pack): Promise<{ adminPublicId: string }> {
  const { publicId: admin } = await createUser(db, auditKey, {
    email: `programmes-admin-${crypto.randomUUID().slice(0, 8)}@school.example`,
    password: "blue-river-lamp-2083",
    fullName: "Programmes Admin",
    roles: [{ role: "admin", scope: "institution" }],
  });
  for (const site of pack.site.programmes) {
    const spec = LEVELS[site.key];
    if (!spec) throw new Error(`No test levels for programme "${site.key}"`);
    const made = await createProgramme(db, auditKey, admin, { name: site.name, sectionKey: site.section, affiliation: site.affiliation });
    if (!made.ok) throw new Error(`Could not make programme "${site.name}": ${made.reason}${"message" in made ? ` (${made.message})` : ""}`);
    for (const name of spec.levels) {
      const level = await addLevel(db, auditKey, admin, made.publicId, { name });
      if (!level.ok) throw new Error(`Could not add level "${name}": ${level.reason}`);
    }
  }
  return { adminPublicId: admin };
}

/** Whether the first programme of a pack is graded here (+2: letters; the others: a percentage). */
export const firstProgrammeGraded = (pack: Pack): boolean => LEVELS[pack.site.programmes[0]!.key]!.graded;
