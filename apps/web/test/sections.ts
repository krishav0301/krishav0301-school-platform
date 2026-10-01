/**
 * A school's own pack lists no sections (D-095): the Admin makes them. Screen tests need a school that already has
 * some, so these are the sections the packs used to list, kept as test data and keyed as the API tests key them.
 */
export const TEST_SECTIONS = {
  royal: [
    { key: "plus2", name: "+2" },
    { key: "bachelors", name: "Bachelor's" },
  ],
  sample: [{ key: "school", name: "School" }],
};

/** The test sections of a pack, by which school it is. */
export const sectionsOf = (pack: { school: { name: string } }) => (pack.school.name.startsWith("Royal") ? TEST_SECTIONS.royal : TEST_SECTIONS.sample);
