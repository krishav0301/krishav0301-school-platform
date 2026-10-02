const { open, shot, finish, BASE } = require("./lib.cjs");
(async () => {
  const s = await open();
  const p = s.page;
  const cardIn = (page, text) => page.locator("h2", { hasText: text }).locator('xpath=ancestor::*[.//button[starts-with(normalize-space(), "Approve")]][1]');
  const card = (text) => cardIn(p, text);
  try {
    await p.goto(BASE + "/portal/approvals", { waitUntil: "networkidle" });
    await p.waitForSelector("text=Discount of");
    await shot(p, "06-01-money-requests", "The Accountant's requests: two discounts, a refund, a payment reversal and the corrected BBS fee structure");

    await card("Sita Chaudhary").getByRole("button", { name: /^Approve/ }).click();
    await p.waitForTimeout(1500);
    await shot(p, "06-02-discount-approved", "Sita Chaudhary's discount approved: it is added to her fee account in the same step", { full: false });

    const rohan = card("Rohan Sah");
    await rohan.getByText("Decline", { exact: true }).click();
    await rohan.locator("textarea").fill("Half fees needs a scholarship decision by the committee. Please bring the family's application to the next meeting.");
    await shot(p, "06-03-discount-decline-reason", "Declining Rohan Sah's 50% discount, with the reason the Accountant will see", { full: false });
    await rohan.getByRole("button", { name: /Decline/ }).last().click();
    await p.waitForTimeout(1500);

    // The same refund open in a second tab: approved here, then tried again there.
    const second = await s.context.newPage();
    await second.goto(BASE + "/portal/approvals", { waitUntil: "networkidle" });
    await second.waitForSelector("text=Refund of");
    await card("Refund of").getByRole("button", { name: /^Approve/ }).click();
    await p.waitForTimeout(1500);
    await shot(p, "06-04-refund-approved", "Puja Yadav's refund approved; the Accountant can now record how it was paid", { full: false });
    await cardIn(second, "Refund of").getByRole("button", { name: /^Approve/ }).click();
    await second.waitForTimeout(1500);
    await shot(second, "06-05-refund-already-decided", "The same refund approved again from a second, older tab: refused as already decided; nothing is applied twice", { full: false });
    await second.close();

    await card("Payment reversal").getByRole("button", { name: /^Approve/ }).click();
    await p.waitForTimeout(1500);
    await card("BBS Year 1").getByRole("button", { name: /^Approve/ }).click();
    await p.waitForTimeout(1500);
    await shot(p, "06-06-all-decided", "The reversal and the corrected BBS structure approved; nothing is waiting");
  } catch (e) {
    console.error(e);
    await p.screenshot({ path: __dirname + "/err.png" });
  }
  await finish(s);
})();
