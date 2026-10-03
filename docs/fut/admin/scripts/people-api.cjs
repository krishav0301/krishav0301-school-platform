// Real sign-ins for the other people in the FUT (Co-ordinator, Accountant, teachers, students), through the API.
const { BASE, token, as, secrets, saveSecrets } = require("./lib.cjs");

const PASS = "Lahan-Spring-Meadow-2083";
const headers = (cookie, body) => ({ Origin: BASE, "Sec-Fetch-Site": "same-origin", ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) });
const cookiesOf = (r) => r.headers.getSetCookie().map((l) => l.split(";")[0]).join("; ");

/** A client for someone with cookies; throws on an unexpected status. */
function client(cookie) {
  return async (method, path, body, okStatuses) => {
    const r = await fetch(BASE + path, { method, headers: headers(cookie, body), body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    if (!(okStatuses ?? [200, 201]).includes(r.status)) throw new Error(`${method} ${path} ${r.status} ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : null;
  };
}

/** First sign-in with a temporary password: choose PASS, keep the cookies. */
async function firstSignIn(email, temporaryPassword) {
  const r = await fetch(BASE + "/api/auth/sign-in", { method: "POST", headers: headers(null, {}), body: JSON.stringify({ email, password: temporaryPassword }) });
  const step = await r.json();
  if (!step.challenge) throw new Error(`sign-in ${email}: ${r.status} ${JSON.stringify(step)}`);
  const changed = await fetch(BASE + "/api/auth/password/change-required", { method: "POST", headers: headers(null, {}), body: JSON.stringify({ challenge: step.challenge, password: PASS }) });
  if (changed.status !== 200) throw new Error(`change ${email}: ${changed.status} ${await changed.text()}`);
  return cookiesOf(changed);
}

/** A later sign-in with PASS. */
async function signIn(email) {
  const r = await fetch(BASE + "/api/auth/sign-in", { method: "POST", headers: headers(null, {}), body: JSON.stringify({ email, password: PASS }) });
  if (r.status !== 200) throw new Error(`sign-in ${email}: ${r.status} ${await r.text()}`);
  return cookiesOf(r);
}

/** Cookies for someone, remembered in secrets.json by email: signs in again when needed. */
async function person(email, temporaryPassword) {
  const known = secrets().people ?? {};
  let cookie;
  if (known[email]) cookie = await signIn(email);
  else {
    cookie = await firstSignIn(email, temporaryPassword);
    saveSecrets({ people: { ...(secrets().people ?? {}), [email]: true } });
  }
  return client(cookie);
}

const admin = () => as(token(secrets().adminId ?? "12655b925d43db8253224e3968496be3", "Rajendra Prasad Shah", "admin"));

module.exports = { person, client, admin, firstSignIn, signIn, PASS };
