import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { logUnhandledError, unhandledErrorResponse } from "../src/core/error-handler";

/**
 * `app.ts` wires these two functions into `OpenAPIHono#onError`; testing them here, on a minimal Hono
 * app, avoids needing a real throwing route wired through the full permission and validation stack.
 */
function throwingApp() {
  const app = new Hono();
  app.get("/boom", () => {
    throw new Error("kaboom");
  });
  app.onError((err, c) => {
    logUnhandledError(err, c.req.method, c.req.path);
    return unhandledErrorResponse(c);
  });
  return app;
}

describe("the unhandled-error handler (Release A go-live checklist, D-067)", () => {
  it("an unhandled exception is logged, not silent, and never leaks its message or stack to the caller", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await throwingApp().request("/boom");

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body).toEqual({ error: "internal_error" });
    expect(JSON.stringify(body)).not.toContain("kaboom");

    expect(spy).toHaveBeenCalledTimes(1);
    const [line, detail] = spy.mock.calls[0]!;
    expect(line).toContain("GET");
    expect(line).toContain("/boom");
    expect(String(detail)).toContain("kaboom"); // the real detail goes to the log, never to the response

    spy.mockRestore();
  });

  it("logUnhandledError itself never assumes the thrown value is an Error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logUnhandledError("not an Error object", "GET", "/boom");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("/boom"), "not an Error object");
    spy.mockRestore();
  });
});
