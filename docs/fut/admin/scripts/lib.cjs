// Shared harness for the admin FUT: one browser, screenshots into docs/fut/admin/screens, a manifest of every step.
// Run against a local school: `npm run dev` in apps/api (with .dev.vars), a fresh database, the pack provisioned and the
// Principal made with `npm run dev:user` (see docs/fut/admin/README.md). Put the Principal's public id in secrets.json as
// {"adminId": "..."} first. State, secrets and the manifest are written next to these scripts and are git-ignored.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require(execFileSync("npm", ["root", "-g"]).toString().trim() + "/playwright");
const { TOTP } = require(require("path").resolve(__dirname, "../../../../apps/api/node_modules/otpauth"));

const REPO = path.resolve(__dirname, "../../../..");
const OUT = path.join(REPO, "docs/fut/admin/screens");
const SP = __dirname;
const STATE = path.join(SP, "state.json");
const SECRETS = path.join(SP, "secrets.json");
const MANIFEST = path.join(SP, "manifest.json");
const BASE = "http://localhost:8787";
fs.mkdirSync(OUT, { recursive: true });

const secrets = () => (fs.existsSync(SECRETS) ? JSON.parse(fs.readFileSync(SECRETS, "utf8")) : {});
const saveSecrets = (s) => fs.writeFileSync(SECRETS, JSON.stringify({ ...secrets(), ...s }, null, 2));
const manifest = () => (fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : []);

function totp() {
  const key = secrets().totpSecret;
  return new TOTP({ secret: key, digits: 6, period: 30, algorithm: "SHA1" }).generate();
}
/** A code not used before: waits for the next 30-second window if this one was already spent. */
let lastCode = null;
async function freshTotp() {
  for (;;) {
    const c = totp();
    if (c !== lastCode && c !== secrets().lastCode) {
      lastCode = c;
      saveSecrets({ lastCode: c });
      return c;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function open({ width = 1440, height = 900, fresh = false, mobile = false } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
    ...(!fresh && fs.existsSync(STATE) ? { storageState: STATE } : {}),
    timezoneId: "Asia/Kathmandu",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return { browser, context, page, errors };
}

/** Screenshot plus a manifest entry. `id` like "03-05-section-added". */
async function shot(page, id, title, opts = {}) {
  await page.waitForTimeout(opts.wait ?? 350);
  const file = `${id}.jpg`;
  if (opts.el) {
    await page.locator(opts.el).first().screenshot({ path: path.join(OUT, file), type: "jpeg", quality: 78 });
  } else if (opts.full === false) {
    await page.screenshot({ path: path.join(OUT, file), type: "jpeg", quality: 78 });
  } else {
    // Grow the window to the page's height, so the sticky sidebar stays where it belongs in a long capture.
    const size = page.viewportSize();
    const height = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
    if (height > size.height) {
      await page.setViewportSize({ width: size.width, height: Math.min(height, 6000) });
      await page.waitForTimeout(250);
    }
    await page.screenshot({ path: path.join(OUT, file), type: "jpeg", quality: 78 });
    if (height > size.height) await page.setViewportSize(size);
  }
  const m = manifest().filter((e) => e.id !== id);
  m.push({ id, file, title, url: page.url().replace(BASE, ""), note: opts.note ?? "" });
  m.sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2));
  console.log("shot", id, "-", title);
}

async function finish({ browser, context, errors }, save = true) {
  if (save) await context.storageState({ path: STATE });
  await browser.close();
  if (errors.length) console.log("PAGE ERRORS:\n" + [...new Set(errors)].join("\n"));
}

// --- Other people's work through the API (preconditions the Principal cannot do), as the screens would.
function token(sub, name, role, scope = "institution", sectionKey) {
  return execFileSync("npx", ["tsx", path.join(SP, "token.mts"), sub, name, role, scope, sectionKey ?? ""], { cwd: path.join(REPO, "apps/api") }).toString().trim();
}
function as(tok) {
  return async (method, p, body, okStatuses) => {
    const r = await fetch(BASE + p, {
      method,
      headers: { Cookie: `__Host-access=${tok}`, "Content-Type": "application/json", Origin: BASE, "Sec-Fetch-Site": "same-origin" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    if (!(okStatuses ?? [200, 201]).includes(r.status)) throw new Error(`${method} ${p} ${r.status} ${text}`);
    return text ? JSON.parse(text) : null;
  };
}

module.exports = { open, shot, finish, totp, freshTotp, secrets, saveSecrets, token, as, BASE, OUT, SP, REPO };
