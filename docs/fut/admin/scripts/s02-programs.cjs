const { open, shot, finish, BASE } = require("./lib.cjs");

(async () => {
  const s = await open();
  const p = s.page;
  const dialog = () => p.locator("dialog[open]");
  const addSection = async (name) => {
    await p.getByRole("button", { name: "Add a Section" }).first().click();
    await dialog().getByLabel("Section name").fill(name);
    await dialog().getByRole("button", { name: "Add a Section" }).click();
    await p.waitForSelector(`h2:has-text("${name}")`);
  };
  try {
    await p.goto(BASE + "/portal/setup/programmes", { waitUntil: "networkidle" });
    await p.waitForSelector("text=No Sections yet");
    await shot(p, "02-01-programs-empty", "Programs (Academic Structure) on a new school: no sections yet, one action to start");

    await p.getByRole("button", { name: "Add a Section" }).first().click();
    await dialog().getByRole("button", { name: "Add a Section" }).click();
    await shot(p, "02-02-section-name-required", "Add a Section with no name: the name is asked for", { el: "dialog[open]" });

    await dialog().getByLabel("Section name").fill("+2 (Grade 11–12)");
    await shot(p, "02-03-section-name-typed", "Add a Section: typing the section's name", { el: "dialog[open]" });
    await dialog().getByRole("button", { name: "Add a Section" }).click();
    await p.waitForSelector('h2:has-text("+2 (Grade 11–12)")');
    await shot(p, "02-04-first-section-added", "The first section is added, with no programmes in it yet");

    await addSection("Bachelor's");
    await addSection("Master's");
    await shot(p, "02-05-three-sections", "Three sections: +2, Bachelor's and Master's");

    // Duplicate name.
    await p.getByRole("button", { name: "Add a Section" }).first().click();
    await dialog().getByLabel("Section name").fill("Bachelor's");
    await dialog().getByRole("button", { name: "Add a Section" }).click();
    await p.waitForTimeout(1500);
    await shot(p, "02-06-section-duplicate-name", "A second section with the same name is refused (\"That already exists.\"); the message shows on the page behind the dialog (finding F-01)", { full: false });
    await dialog().getByRole("button", { name: "Close" }).click();
  } catch (e) {
    console.error(e);
    await p.screenshot({ path: __dirname + "/err.png", fullPage: true });
  }
  await finish(s);
})();
