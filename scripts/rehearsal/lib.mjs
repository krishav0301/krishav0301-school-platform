export const BASE = process.env.BASE || "http://localhost:8787";
export class Client {
  constructor(name) { this.name = name; this.jar = {}; }
  cookieHeader() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join("; "); }
  async req(method, path, body, expect = [200, 201]) {
    const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", Origin: BASE, Cookie: this.cookieHeader() }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(";"); const i = pair.indexOf("="); const k = pair.slice(0, i), v = pair.slice(i + 1); if (/Max-Age=0/i.test(c) || v === "") delete this.jar[k]; else this.jar[k] = v; }
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
    if (expect !== "any" && !expect.includes(res.status)) throw new Error(`${this.name} ${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
    return { status: res.status, json, text };
  }
  get = (p, e) => this.req("GET", p, undefined, e);
  post = (p, b, e) => this.req("POST", p, b ?? {}, e);
  put = (p, b, e) => this.req("PUT", p, b, e);
  patch = (p, b, e) => this.req("PATCH", p, b, e);
  async signIn(email, password) {
    const r = await this.post("/api/auth/sign-in", { email, password }, [200]);
    if (r.json?.passwordChange === "required") {
      const next = "Fresh-Pass-" + Math.random().toString(36).slice(2, 10) + "-Sunrise9";
      const c = await this.post("/api/auth/password/change-required", { challenge: r.json.challenge, password: next }, [200]);
      this.password = next; return { changedPassword: true, json: c.json };
    }
    this.password = password; return { changedPassword: false, json: r.json };
  }
}
export const pad = (n, w = 2) => String(n).padStart(w, "0");
