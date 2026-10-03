const { open, shot, finish, BASE } = require("./lib.cjs");

(async () => {
  const s = await open();
  const p = s.page;
  const d = () => p.locator("dialog[open]");
  const row = (name) => p.locator("li").filter({ hasText: name }).first();
  try {
    await p.goto(BASE + "/portal/people", { waitUntil: "networkidle" });
    await p.waitForSelector("text=Ramesh Shrestha");
    if (!process.env.RESUME) {
    await row("Ramesh Shrestha").getByRole("button", { name: /More actions/ }).click();
    await shot(p, "04-17-row-menu-inactive", "The row's More menu for a switched-off person", { full: false });
    await p.keyboard.press("Escape");
    await row("Ramesh Shrestha").getByRole("button", { name: "Switch on" }).click();
    await p.waitForTimeout(1200);
    await shot(p, "04-18-switched-on", "Ramesh is switched on again; he can sign in once more", { full: false });
    }

    if (process.env.RESUME !== "2") {
    await p.getByRole("button", { name: "Manage access for Gita Thapa" }).click();
    await d().getByRole("button", { name: "New temporary password" }).click();
    await p.waitForTimeout(1200);
    await p.waitForSelector("text=Temporary password for Gita Thapa");
    await shot(p, "04-19-new-temporary-password", "Manage access › New temporary password for Gita: shown once, on the page, to give her in person", { full: false });
    await p.getByRole("button", { name: "I have noted it" }).click();
    await p.waitForTimeout(600);

    // Search and filters (server side).
    await p.getByPlaceholder("Search staff…").fill("hari");
    await p.waitForTimeout(1200);
    await shot(p, "04-20-search", "Search 'hari': only Hari Prasad Yadav", { full: false });
    await p.getByPlaceholder("Search staff…").fill("nobody-like-this");
    await p.waitForTimeout(1200);
    await shot(p, "04-21-search-none", "A search that matches nobody says so", { full: false });
    await p.getByPlaceholder("Search staff…").fill("");
    await p.waitForTimeout(1000);
    }
    await p.getByLabel("Role", { exact: true }).selectOption({ index: 2 });
    await p.waitForTimeout(1200);
    await shot(p, "04-22-filter-role", "Filter Role: Accountants only", { full: false });
    await p.getByLabel("Role", { exact: true }).selectOption({ index: 0 });
    await p.getByLabel("Access", { exact: true }).selectOption({ index: 1 });
    await p.waitForTimeout(1200);
    await shot(p, "04-23-filter-access", "Filter Access: the first section choice", { full: false });
    await p.getByLabel("Access", { exact: true }).selectOption({ index: 0 });
    await p.waitForTimeout(800);

    await p.getByRole("tab", { name: "Teaching" }).click();
    await p.waitForTimeout(1200);
    await shot(p, "04-24-teaching-empty", "Teaching tab before any teacher exists: teachers are added by a Co-ordinator");
  } catch (e) {
    console.error(e);
    await p.screenshot({ path: __dirname + "/err.png", fullPage: true });
  }
  await finish(s);
})();
