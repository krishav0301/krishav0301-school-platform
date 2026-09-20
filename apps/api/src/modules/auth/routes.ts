import { z } from "@hono/zod-openapi";

import { defineRoute } from "../../core/routes";
import { clearSessionCookies, readRefreshCookie, setSessionCookies } from "../../core/session-cookies";
import type { App } from "../../core/types";
import { LOCKOUT_WINDOW_MINUTES, refreshSession, signIn, signOut } from "./service";

const RoleClaimSchema = z
  .object({
    role: z.string(),
    scope: z.enum(["own", "assigned", "section", "institution"]),
    section: z.string().optional(),
  })
  .openapi("RoleClaim");

const UserSchema = z.object({ id: z.string(), fullName: z.string(), email: z.string() }).openapi("SessionUser");

const SessionSchema = z.object({ user: UserSchema, roles: z.array(RoleClaimSchema) }).openapi("Session");

const ErrorSchema = z.object({ error: z.string() }).openapi("ApiError");

const SignInBody = z
  .object({
    email: z.string().min(3).max(254),
    // Length is checked on sign-up. Here it only stops a huge value from being hashed.
    password: z.string().min(1).max(1000),
  })
  .openapi("SignInBody");

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

export function registerAuth(app: App): void {
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/auth/sign-in",
      operationId: "sign_in",
      tags: ["auth"],
      description: "Sign in with email and password. Sets the session cookies.",
      access: { public: true },
      request: { body: { required: true, content: json(SignInBody) } },
      responses: {
        200: { description: "Signed in", content: json(SessionSchema) },
        401: { description: "Wrong email or password. The same answer for an unknown email.", content: json(ErrorSchema) },
        429: { description: "Too many recent failed attempts", content: json(ErrorSchema) },
      },
    },
    async (c) => {
      const body = c.req.valid("json");
      const result = await signIn(
        { db: c.env.DB, sessionSecret: c.env.SESSION_SECRET },
        {
          email: body.email,
          password: body.password,
          ip: c.req.header("CF-Connecting-IP") ?? null,
          userAgent: c.req.header("User-Agent") ?? null,
        },
      );

      if (!result.ok) {
        if (result.reason === "throttled") {
          c.header("Retry-After", String(LOCKOUT_WINDOW_MINUTES * 60));
          return c.json({ error: "too_many_attempts" }, 429);
        }
        return c.json({ error: "invalid_credentials" }, 401);
      }

      setSessionCookies(c, result.accessToken, result.refreshToken);
      return c.json({ user: result.user, roles: result.roles }, 200);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/auth/refresh",
      operationId: "refresh_session",
      tags: ["auth"],
      description: "Swaps the refresh cookie for a new pair of cookies.",
      access: { public: true },
      responses: {
        200: { description: "Refreshed", content: json(SessionSchema) },
        401: { description: "No valid session. `refresh_in_progress` means retry once.", content: json(ErrorSchema) },
      },
    },
    async (c) => {
      const token = readRefreshCookie(c);
      if (!token) return c.json({ error: "unauthenticated" }, 401);

      const result = await refreshSession({ db: c.env.DB, sessionSecret: c.env.SESSION_SECRET }, token);
      if (!result.ok) {
        // Two tabs racing: the other one already holds the new cookie. Keep ours and let the client retry.
        if (result.reason === "in_progress") return c.json({ error: "refresh_in_progress" }, 401);
        clearSessionCookies(c);
        return c.json({ error: "unauthenticated" }, 401);
      }

      setSessionCookies(c, result.accessToken, result.refreshToken);
      return c.json({ user: result.user, roles: result.roles }, 200);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/auth/sign-out",
      operationId: "sign_out",
      tags: ["auth"],
      description: "Ends the session and clears the cookies. Always succeeds.",
      access: { public: true },
      responses: { 204: { description: "Signed out" } },
    },
    async (c) => {
      await signOut({ db: c.env.DB, sessionSecret: c.env.SESSION_SECRET }, readRefreshCookie(c));
      clearSessionCookies(c);
      return c.body(null, 204);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/auth/me",
      operationId: "current_session",
      tags: ["auth"],
      description: "Who is signed in, from the signed access cookie. No database read.",
      access: { authenticated: true },
      responses: {
        200: { description: "The signed-in user", content: json(z.object({ name: z.string(), roles: z.array(RoleClaimSchema) })) },
        401: { description: "Not signed in, or the access cookie expired", content: json(ErrorSchema) },
      },
    },
    async (c) => {
      const auth = c.get("auth")!;
      return c.json({ name: auth.name, roles: auth.roles }, 200);
    },
  );
}
