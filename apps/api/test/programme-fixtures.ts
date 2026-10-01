import type { Pack } from "../src/core/config";
import { addLevel, createProgramme, updateProgramme } from "../src/modules/academics/service";
import { createUser } from "../src/modules/accounts/service";

/**
 * A school starts with no programmes (D-087): the Admin makes them on the Programmes screen. Tests that need a
 * school's programmes make them the same way, through the services that screen calls, as an Admin. These are the
 * programmes, levels and grading policies the packs used to seed, kept here as test data, keyed by the pack's
 * `site.programmes` entry that gives each its name, section and affiliation.
 */
const LEVELS: Record<string, { levels: string[]; gradingPolicy: "neb_gpa" | "percentage_division" }> = {
  "plus2-sample": { levels: ["Grade 11", "Grade 12"], gradingPolicy: "neb_gpa" },
  "bachelors-sample": { levels: ["Year 1", "Year 2", "Year 3", "Year 4"], gradingPolicy: "percentage_division" },
  "early-years": { levels: ["Nursery", "KG"], gradingPolicy: "percentage_division" },
  primary: { levels: ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5"], gradingPolicy: "percentage_division" },
  "lower-secondary": { levels: ["Grade 6", "Grade 7", "Grade 8"], gradingPolicy: "percentage_division" },
  secondary: { levels: ["Grade 9", "Grade 10"], gradingPolicy: "percentage_division" },
};

/** Makes the pack's programmes, in its order, with their levels and grading policy, as an Admin would. Returns the Admin. */
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
    const policy = await updateProgramme(db, auditKey, admin, made.publicId, { gradingPolicy: spec.gradingPolicy });
    if (!policy.ok) throw new Error(`Could not set the grading policy of "${site.name}": ${policy.reason}`);
  }
  return { adminPublicId: admin };
}

/** The grading policy the first programme of a pack is given here (what the pack used to seed). */
export const firstProgrammePolicy = (pack: Pack): "neb_gpa" | "percentage_division" => LEVELS[pack.site.programmes[0]!.key]!.gradingPolicy;
