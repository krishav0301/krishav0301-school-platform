import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/usr/lib/node_modules/");
const { chromium } = require(process.env.PW_PATH || "playwright");
import { Client, BASE } from "./lib.mjs";
const state = JSON.parse(fs.readFileSync(process.env.STATE || new URL("./state.json", import.meta.url)));
const PW = "Maple-River-2026-sunrise";
const sess = async (email, pw) => { const c = new Client(email); await c.signIn(email, pw); c.email = email; return c; };
const people = {
  student: await sess(state.students.find((s) => s.first === "Aadarsh" && s.last === "Mandal").email, state.students.find((s) => s.first === "Aadarsh" && s.last === "Mandal").tempPassword),
  classTeacher: await sess(state.teachers.hari.email, state.teachers.hari.password),
  subjectTeacher: await sess(state.teachers.sunita.email, state.teachers.sunita.password),
  coordinator: await sess("coordinator@lahan.test", PW), principal: await sess("principal@lahan.test", PW), accountant: await sess("accountant@lahan.test", PW),
};
const c2 = state.classes["Class 2"], t1 = state.terminals[0].id;
const sheet = (await people.coordinator.get(`/api/results/classes/${c2.id}/terminals/${t1}/sheet`)).json;
const cardOf = (frag) => sheet.students.find((s) => s.name.includes(frag)).cardId;
const finalSheet = (await people.coordinator.get(`/api/results/classes/${c2.id}/final/sheet`)).json;
const errors = []; const bad = [];
const browser = await chromium.launch();
async function open(role) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${role}: ${String(e).slice(0, 200)}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${role} console: ${m.text().slice(0, 200)}`); });
  page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/api/") && !r.url().includes("/api/auth/me")) bad.push(`${role}: ${r.status()} ${new URL(r.url()).pathname}`); });
  const c = people[role];
  await page.goto(BASE + "/sign-in"); await page.waitForLoadState("networkidle");
  await page.getByLabel(/email/i).first().fill(c.email); await page.getByLabel(/password/i).first().fill(c.password);
  await page.getByRole("button", { name: /sign in/i }).first().click(); await page.waitForURL(/\/portal/, { timeout: 30000 }); await page.waitForLoadState("networkidle");
  return { ctx, page };
}
const go = async (page, url, name) => { await page.goto(BASE + url); await page.waitForLoadState("networkidle"); await page.waitForTimeout(900); if (name) await page.screenshot({ path: `shots/${name}.png`, fullPage: false }); };

// 1. the student
{ const { ctx, page } = await open("student");
  await go(page, "/portal/results", "student-1-results");
  await page.getByRole("link", { name: /Marks card/i }).first().click(); await page.waitForLoadState("networkidle"); await page.waitForTimeout(900);
  await page.screenshot({ path: "shots/student-2-card.png" });
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByRole("button", { name: "Download PDF" }).click()]); await d.saveAs("dl/student-card.pdf"); console.log("student download:", d.suggestedFilename());
  await page.emulateMedia({ media: "print" }); await page.pdf({ path: "dl/student-card-print.pdf", format: "A4", printBackground: true });
  await go(page, `/portal/results/ledger?class=${c2.id}&exam=${t1}`, "student-3-ledger-refused"); await ctx.close(); }
// 2. the class teacher
{ const { ctx, page } = await open("classTeacher");
  await go(page, "/portal/classes", "teacher-1-classes");
  await go(page, `/portal/classes/class?id=${c2.id}&tab=results`, "teacher-2-results");
  const btn = page.getByRole("link", { name: /Mark ledger/i }).first(); console.log("class teacher sees the Mark ledger button:", await btn.count() > 0);
  await btn.click(); await page.waitForLoadState("networkidle"); await page.waitForTimeout(900); await page.screenshot({ path: "shots/teacher-3-ledger.png" });
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByRole("button", { name: "Download PDF" }).click()]); await d.saveAs("dl/class2-ledger.pdf"); console.log("ledger download:", d.suggestedFilename());
  await page.emulateMedia({ media: "print" }); await page.pdf({ path: "dl/class2-ledger-print.pdf", format: "A4", printBackground: true }); await page.emulateMedia({ media: "screen" });
  await go(page, `/portal/classes/class?id=${c2.id}`, "teacher-4-students"); await ctx.close(); }
// 3. the co-ordinator: the awkward cards
{ const { ctx, page } = await open("coordinator");
  await go(page, `/portal/classes/class?id=${c2.id}`, "coord-1-students");
  for (const [frag, name] of [["Jibika", "name-only"], ["मण्डल", "nepali"], ["Suraj", "absent"], ["Aaron", "failing"], ["Aadarsh Yadav", "edge-marks"]]) {
    await go(page, `/portal/results/card?id=${cardOf(frag)}`, `card-${name}`);
    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByRole("button", { name: "Download PDF" }).click()]); await d.saveAs(`dl/card-${name}.pdf`);
    await page.emulateMedia({ media: "print" }); await page.pdf({ path: `dl/card-${name}-print.pdf`, format: "A4", printBackground: true }); await page.emulateMedia({ media: "screen" });
  }
  await go(page, `/portal/results/ledger?class=${c2.id}&exam=final`, "coord-final-ledger");
  await go(page, `/portal/results/card?id=${finalSheet.students[0].cardId}`, "coord-final-card"); await ctx.close(); }
// 4. principal, subject teacher, accountant: what they see
{ const { ctx, page } = await open("principal"); await go(page, `/portal/classes/class?id=${c2.id}`, "principal-1-students"); await go(page, `/portal/classes/class?id=${c2.id}&tab=results`, "principal-2-results"); await ctx.close(); }
{ const { ctx, page } = await open("subjectTeacher"); await go(page, `/portal/classes/class?id=${c2.id}`, "subject-1-students"); await go(page, `/portal/results/card?id=${cardOf("Jibika")}`, "subject-2-card-refused"); await ctx.close(); }
{ const { ctx, page } = await open("accountant"); await go(page, `/portal/results/card?id=${cardOf("Jibika")}`, "accountant-1-card-refused"); await ctx.close(); }
await browser.close();
console.log("page errors:", errors.length ? errors : "none");
console.log("unexpected 4xx/5xx from the API during the browsing:", bad.length ? [...new Set(bad)] : "none");
