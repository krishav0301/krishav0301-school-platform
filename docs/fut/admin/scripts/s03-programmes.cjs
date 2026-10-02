const { open, shot, finish, BASE } = require("./lib.cjs");

(async () => {
  const s = await open();
  const p = s.page;
  const dialog = () => p.locator("dialog[open]");
  const section = (name) => p.locator(`h2:text-is("${name}")`).locator('xpath=ancestor::*[.//button[contains(normalize-space(), "Add a Programme")]][1]');
  const programme = (name) => p.locator("li").filter({ has: p.locator(`h3:text-is("${name}")`) }).first();
  const expandSection = async (name) => {
    const show = p.getByRole("button", { name: `Show ${name}`, exact: true });
    if (await show.count()) await show.click();
  };
  const addProgramme = async (sectionName, name, affiliation) => {
    await expandSection(sectionName);
    await section(sectionName).getByRole("button", { name: "Add a Programme" }).click();
    await dialog().getByLabel("Name", { exact: true }).fill(name);
    if (affiliation) await dialog().getByLabel("Affiliation").fill(affiliation);
    await dialog().getByRole("button", { name: "Add a Programme" }).click();
    await p.waitForSelector(`h3:text-is("${name}")`);
  };
  const addLevel = async (prog, level) => {
    const show = p.getByRole("button", { name: `Show ${prog}`, exact: true });
    if (await show.count()) await show.click();
    await programme(prog).getByRole("button", { name: "Add a Level", exact: true }).click();
    await dialog().getByRole("textbox").fill(level);
    await dialog().getByRole("button", { name: "Add a Level" }).click();
    await programme(prog).locator(`text="${level}"`).first().waitFor();
  };
  try {
    await p.goto(BASE + "/portal/setup/programmes", { waitUntil: "networkidle" });
    await expandSection("+2 (Grade 11–12)");
    await section("+2 (Grade 11–12)").getByRole("button", { name: "Add a Programme" }).click();
    await dialog().getByRole("button", { name: "Add a Programme" }).click();
    await shot(p, "03-01-programme-name-required", "Add a Programme with no name: the name is asked for", { el: "dialog[open]" });
    await dialog().getByLabel("Name", { exact: true }).fill("+2 Science");
    await dialog().getByLabel("Affiliation").fill("NEB");
    await shot(p, "03-02-programme-form-filled", "Add a Programme: name and affiliation", { el: "dialog[open]" });
    await dialog().getByRole("button", { name: "Add a Programme" }).click();
    await p.waitForSelector('h3:text-is("+2 Science")');
    await shot(p, "03-03-programme-added", "The programme is added to the +2 section, with no levels yet");

    await programme("+2 Science").getByRole("button", { name: "Add a Level", exact: true }).click();
    await dialog().getByRole("button", { name: "Add a Level" }).click();
    await shot(p, "03-04-level-name-required", "Add a Level with no name: the name is asked for", { el: "dialog[open]" });
    await dialog().getByRole("textbox").fill("Grade 11");
    await dialog().getByRole("button", { name: "Add a Level" }).click();
    await programme("+2 Science").locator('text="Grade 11"').first().waitFor();
    await addLevel("+2 Science", "Grade 12");
    await shot(p, "03-05-levels-added", "+2 Science now has Grade 11 and Grade 12");

    await addProgramme("+2 (Grade 11–12)", "+2 Management", "NEB");
    await addLevel("+2 Management", "Grade 11");
    await addLevel("+2 Management", "Grade 12");
    await addProgramme("Bachelor's", "BBS", "Tribhuvan University (TU)");
    for (const y of ["Year 1", "Year 2", "Year 3", "Year 4"]) await addLevel("BBS", y);
    await addProgramme("Bachelor's", "BIT", "Purbanchal University (PU)");
    for (const y of ["Year 1", "Year 2"]) await addLevel("BIT", y);
    await addProgramme("Master's", "MBS", "TU");
    await addLevel("MBS", "Semester One");
    await shot(p, "03-06-full-structure", "The full structure: 3 sections, 5 programmes, 11 levels");

    // Edit a programme: grading policy.
    await p.getByRole("button", { name: "Edit +2 Science", exact: true }).click();
    await shot(p, "03-07-programme-edit", "Edit a programme: name, affiliation and grading (results cannot be published until grading is set)", { el: "dialog[open]" });
    await dialog().getByLabel("Grading").selectOption({ label: "NEB letter grades and GPA" });
    await dialog().getByRole("button", { name: "Save changes" }).click();
    await p.waitForTimeout(800);
    await p.getByRole("button", { name: "Edit +2 Management", exact: true }).click();
    await dialog().getByLabel("Grading").selectOption({ label: "NEB letter grades and GPA" });
    await dialog().getByRole("button", { name: "Save changes" }).click();
    await p.waitForTimeout(800);
    for (const prog of ["BBS", "BIT", "MBS"]) {
      await p.getByRole("button", { name: `Edit ${prog}`, exact: true }).click();
      await dialog().getByLabel("Grading").selectOption({ label: "Percentage and division" });
      await dialog().getByRole("button", { name: "Save changes" }).click();
      await p.waitForTimeout(800);
    }
    await shot(p, "03-08-grading-set", "Grading set: NEB GPA for +2, percentage and division for the bachelor's and master's programmes");

    // Rename a level, switch it off and on.
    await programme("MBS").getByRole("button", { name: "Options for Semester One" }).click();
    await shot(p, "03-09-level-options", "A level's options: rename, switch off, delete (delete only while nothing is attached)", { el: "dialog[open]" });
    await dialog().getByRole("textbox").fill("Year 1");
    await dialog().getByRole("button", { name: "Save name" }).click();
    await programme("MBS").locator('text="Year 1"').first().waitFor();
    await shot(p, "03-10-level-renamed", "The level is renamed to Year 1");
    await programme("MBS").getByRole("button", { name: "Options for Year 1" }).click();
    await dialog().getByRole("button", { name: "Switch off" }).click();
    await p.waitForTimeout(900);
    await shot(p, "03-11-level-switched-off", "The level is switched off: it stays, marked Switched off, and nothing is lost");
    await programme("MBS").getByRole("button", { name: "Options for Year 1" }).click();
    await dialog().getByRole("button", { name: "Switch on" }).click();
    await p.waitForTimeout(900);

    // Delete the level, then the programme, then the section (nothing attached).
    await programme("MBS").getByRole("button", { name: "Options for Year 1" }).click();
    await dialog().getByRole("button", { name: "Delete Year 1" }).click();
    await shot(p, "03-12-level-delete-confirm", "Delete asks once more, because it cannot be undone", { el: "dialog[open]" });
    await dialog().getByRole("button", { name: "Yes, delete Year 1" }).click();
    await p.waitForTimeout(900);
    await p.getByRole("button", { name: "Edit MBS", exact: true }).click();
    await dialog().getByRole("button", { name: "Delete MBS" }).click();
    await dialog().getByRole("button", { name: "Yes, delete MBS" }).click();
    await p.waitForTimeout(900);
    await shot(p, "03-13-programme-deleted", "The empty MBS programme is deleted");

    // Section edit: rename and switch off.
    await p.getByRole("button", { name: "Edit Master's", exact: true }).click();
    await shot(p, "03-14-section-edit", "Edit a section: rename, switch off, delete", { el: "dialog[open]" });
    await dialog().getByRole("textbox").fill("Master's Degrees");
    await dialog().getByRole("button", { name: "Save name" }).click();
    await p.waitForSelector('h2:text-is("Master\'s Degrees")');
    await p.getByRole("button", { name: "Edit Master's Degrees", exact: true }).click();
    await dialog().getByRole("button", { name: "Switch off" }).click();
    await p.waitForTimeout(900);
    await shot(p, "03-15-section-switched-off", "Master's Degrees is renamed and switched off: kept, but no longer offered");

    // A section in use cannot be deleted.
    await p.getByRole("button", { name: "Edit Bachelor's", exact: true }).click();
    await shot(p, "03-16-section-in-use-no-delete", "A section with programmes cannot be deleted: it says why and suggests switching it off", { el: "dialog[open]" });
    await dialog().getByRole("button", { name: "Close" }).click();
  } catch (e) {
    console.error(e);
    await p.screenshot({ path: __dirname + "/err.png", fullPage: true });
  }
  await finish(s);
})();
