// The approvals inbox as the Principal uses it since D-102: Review opens a panel; Approve request asks once more; Decline
// request asks for a reason; the outcome is said in the panel, closed with Done or Close.
const panel = (p) => p.locator("dialog[open]").first();

async function review(p, label) {
  await p.getByRole("button", { name: label }).first().click();
  await p.waitForTimeout(1200);
}
async function approve(p, { confirmShot } = {}) {
  await panel(p).getByRole("button", { name: "Approve request" }).click();
  await p.waitForTimeout(400);
  if (confirmShot) await confirmShot();
  await p.locator("dialog[role=alertdialog][open]").getByRole("button", { name: "Approve request" }).click();
  await p.waitForTimeout(1500);
}
async function decline(p, reason, { emptyShot, filledShot } = {}) {
  await panel(p).getByRole("button", { name: "Decline request" }).click();
  await p.waitForTimeout(300);
  if (emptyShot) {
    await panel(p).getByRole("button", { name: "Decline request" }).click();
    await p.waitForTimeout(300);
    await emptyShot();
  }
  await panel(p).getByLabel("Reason").fill(reason);
  if (filledShot) await filledShot();
  await panel(p).getByRole("button", { name: "Decline request" }).click();
  await p.waitForTimeout(1500);
}
async function finishPanel(p) {
  await panel(p).getByRole("button", { name: /^(Done|Close)$/ }).last().click();
  await p.waitForTimeout(1200);
}

module.exports = { panel, review, approve, decline, finishPanel };
