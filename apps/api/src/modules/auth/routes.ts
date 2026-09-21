import { z } from "@hono/zod-openapi";

import { runInBackground } from "../../core/background";
import { runOutbox } from "../../core/notifications";
import { defineRoute } from "../../core/routes";
import { clearSessionCookies, readRefreshCookie, setSessionCookies } from "../../core/session-cookies";
import type { App } from "../../core/types";
import { changeRequiredPassword } from "./first-password";
import { confirmPasswordReset, requestPasswordReset } from "./password-reset";
import { beginTwoFactorSetup, enableTwoFactor, verifyTwoFactor, type TwoFactorDeps } from "./two-factor";
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

/** The password was right, but a second step is still needed: no session yet, only a challenge for that step. */
const TwoFactorStepSchema = z.object({ twoFactor: z.enum(["required", "setup"]), challenge: z.string() }).openapi("TwoFactorStep");

/** The password was right but it was a temporary one: no session yet, only a challenge to choose a new password (D-059). */
const PasswordChangeStepSchema = z.object({ passwordChange: z.literal("required"), challenge: z.string() }).openapi("PasswordChangeStep");

const ChangeRequiredBody = z
  .strictObject({
    challenge: z.string().min(1).max(1000),
    // The policy (length, common passwords, the school's name, ...) is checked in the service, which says which rule failed.
    password: z.string().min(1).max(1000),
  })
  .openapi("ChangeRequiredPasswordBody");

const SamePasswordSchema = z.object({ error: z.literal("same_password") }).openapi("SamePassword");

const ChallengeBody = z.strictObject({ challenge: z.string().min(1).max(1000) }).openapi("TwoFactorSetupBody");
const CodeBody = z.strictObject({ challenge: z.string().min(1).max(1000), code: z.string().min(1).max(64) }).openapi("TwoFactorCodeBody");
const RecoverySessionSchema = z.object({ user: UserSchema, roles: z.array(RoleClaimSchema), recoveryCodes: z.array(z.string()) }).openapi("SessionWithRecoveryCodes");

const twoFactorDeps = (env: { DB: D1Database; SESSION_SECRET: string; DATA_KEY: string; AUDIT_HMAC_KEY: string }): TwoFactorDeps => ({
  db: env.DB,
  sessionSecret: env.SESSION_SECRET,
  dataKey: env.DATA_KEY,
  auditKey: env.AUDIT_HMAC_KEY,
});

const SignInBody = z
  .object({
    email: z.string().min(3).max(254),
    // Length is checked on sign-up. Here it only stops a huge value from being hashed.
    password: z.string().min(1).max(1000),
  })
  .openapi("SignInBody");

const ResetRequestBody = z.strictObject({ email: z.string().min(3).max(254) }).openapi("PasswordResetRequest");

const ResetConfirmBody = z
  .strictObject({
    token: z.string().min(1).max(200),
    // The policy (length, common passwords, ...) is checked in the service, which says which rule failed.
    password: z.string().min(1).max(1000),
  })
  .openapi("PasswordResetConfirm");

const WeakPasswordSchema = z
  .object({ error: z.literal("weak_password"), problems: z.array(z.enum(["too_short", "too_long", "common", "contains_email", "contains_school_name"])) })
  .openapi("WeakPassword");

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

export function registerAuth(app: App): void {
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/auth/sign-in",
      operationId: "sign_in",
      tags: ["auth"],
      description:
        "Sign in with email and password. Sets the session cookies. If the password was a temporary one, the answer is a `passwordChange` step instead (no session, no cookies) and the person must choose a new password first.",
      access: { public: true },
      request: { body: { required: true, content: json(SignInBody) } },
      responses: {
        200: {
          description: "Signed in (a session, with the cookies set), or the password was right and a second step is needed (a challenge, no session)",
          content: json(z.union([SessionSchema, TwoFactorStepSchema, PasswordChangeStepSchema])),
        },
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

      if (result.passwordChange) return c.json({ passwordChange: result.passwordChange, challenge: result.challenge }, 200);
      if (result.twoFactor) return c.json({ twoFactor: result.twoFactor, challenge: result.challenge }, 200);

      setSessionCookies(c, result.accessToken, result.refreshToken);
      return c.json({ user: result.user, roles: result.roles }, 200);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/auth/2fa/verify",
      operationId: "verify_two_factor",
      tags: ["auth"],
      description: "The second step of sign-in: the six-digit code from the authenticator app (or a recovery code) plus the challenge from sign-in. Sets the session cookies.",
      access: { public: true },
      request: { body: { required: true, content: json(CodeBody) } },
      responses: {
        200: { description: "Signed in", content: json(SessionSchema) },
        401: { description: "`invalid_code` (wrong, already used or expired) or `invalid_challenge` (start again from the password)", content: json(ErrorSchema) },
        429: { description: "Too many recent failed attempts", content: json(ErrorSchema) },
      },
    },
    async (c) => {
      const body = c.req.valid("json");
      const result = await verifyTwoFactor(twoFactorDeps(c.env), {
        challenge: body.challenge,
        code: body.code,
        ip: c.req.header("CF-Connecting-IP") ?? null,
        userAgent: c.req.header("User-Agent") ?? null,
      });
      if (!result.ok) {
        if (result.reason === "throttled") {
          c.header("Retry-After", String(LOCKOUT_WINDOW_MINUTES * 60));
          return c.json({ error: "too_many_attempts" }, 429);
        }
        return c.json({ error: result.reason }, 401);
      }
      setSessionCookies(c, result.accessToken, result.refreshToken);
      return c.json({ user: result.user, roles: result.roles }, 200);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/auth/2fa/setup",
      operationId: "begin_two_factor_setup",
      tags: ["auth"],
      description: "Starts setting up the authenticator app: returns a new secret (to type in or scan) and the address an app can open. Asking again replaces an unconfirmed secret.",
      access: { public: true },
      request: { body: { required: true, content: json(ChallengeBody) } },
      responses: {
        200: { description: "The secret to add to the app", content: json(z.object({ secret: z.string(), otpauthUri: z.string() })) },
        401: { description: "The challenge is missing, expired or for another step", content: json(ErrorSchema) },
        409: { description: "Already turned on", content: json(ErrorSchema) },
      },
    },
    async (c) => {
      const result = await beginTwoFactorSetup(twoFactorDeps(c.env), { challenge: c.req.valid("json").challenge });
      if (!result.ok) return result.reason === "already_enabled" ? c.json({ error: "already_enabled" }, 409) : c.json({ error: "invalid_challenge" }, 401);
      return c.json({ secret: result.secret, otpauthUri: result.otpauthUri }, 200);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/auth/2fa/enable",
      operationId: "enable_two_factor",
      tags: ["auth"],
      description: "Confirms the first code from the app, turns two-step sign-in on, signs the person in (cookies set) and returns ten single-use recovery codes, shown this once.",
      access: { public: true },
      request: { body: { required: true, content: json(CodeBody) } },
      responses: {
        200: { description: "Turned on and signed in", content: json(RecoverySessionSchema) },
        401: { description: "`invalid_code` or `invalid_challenge`", content: json(ErrorSchema) },
        409: { description: "`no_setup`: no secret was started, or it is already on", content: json(ErrorSchema) },
        429: { description: "Too many recent failed attempts", content: json(ErrorSchema) },
      },
    },
    async (c) => {
      const body = c.req.valid("json");
      const result = await enableTwoFactor(twoFactorDeps(c.env), {
        challenge: body.challenge,
        code: body.code,
        ip: c.req.header("CF-Connecting-IP") ?? null,
        userAgent: c.req.header("User-Agent") ?? null,
      });
      if (!result.ok) {
        if (result.reason === "throttled") {
          c.header("Retry-After", String(LOCKOUT_WINDOW_MINUTES * 60));
          return c.json({ error: "too_many_attempts" }, 429);
        }
        if (result.reason === "no_setup") return c.json({ error: "no_setup" }, 409);
        return c.json({ error: result.reason }, 401);
      }
      setSessionCookies(c, result.accessToken, result.refreshToken);
      return c.json({ user: result.user, roles: result.roles, recoveryCodes: result.recoveryCodes }, 200);
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
      method: "post",
      path: "/api/auth/password-reset/request",
      operationId: "request_password_reset",
      tags: ["auth"],
      description:
        "Asks for a password-reset email. The answer is always 202, whether or not the address has an account, so it cannot be used to find out who is registered. Limited per account and per address.",
      access: { public: true },
      request: { body: { required: true, content: json(ResetRequestBody) } },
      responses: { 202: { description: "If the address has an account, an email is on its way", content: json(z.object({ accepted: z.literal(true) })) } },
    },
    async (c) => {
      const body = c.req.valid("json");
      await requestPasswordReset({ db: c.env.DB, dataKey: c.env.DATA_KEY }, { email: body.email, ip: c.req.header("CF-Connecting-IP") ?? null });
      // Deliver now rather than wait for the sweep. If it fails, the outbox retries.
      const pending = runInBackground(c, runOutbox(c.env));
      if (pending) await pending;
      return c.json({ accepted: true as const }, 202);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/auth/password-reset/confirm",
      operationId: "confirm_password_reset",
      tags: ["auth"],
      description: "Sets a new password with the token from the emailed link. The token works once. Ends every session the account had.",
      access: { public: true },
      request: { body: { required: true, content: json(ResetConfirmBody) } },
      responses: {
        204: { description: "Password changed" },
        400: { description: "The link is wrong, already used or expired (the same answer for all three)", content: json(ErrorSchema) },
        422: { description: "The new password is not acceptable; the link still works", content: json(WeakPasswordSchema) },
      },
    },
    async (c) => {
      const body = c.req.valid("json");
      const result = await confirmPasswordReset({ db: c.env.DB, auditKey: c.env.AUDIT_HMAC_KEY }, { token: body.token, password: body.password });
      if (result.ok) return c.body(null, 204);
      if (result.reason === "weak_password") return c.json({ error: "weak_password" as const, problems: result.problems }, 422);
      return c.json({ error: "invalid_or_expired_link" }, 400);
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

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/auth/password/change-required",
      operationId: "change_required_password",
      tags: ["auth"],
      description:
        "Choose a password of your own after signing in with a temporary one. Needs the challenge that sign-in returned (not a session, and it works once). Then carries on as sign-in does: an authenticator step, or the session with its cookies.",
      access: { public: true },
      request: { body: { required: true, content: json(ChangeRequiredBody) } },
      responses: {
        200: {
          description: "Signed in (a session, with the cookies set), or the person still has an authenticator step to do (a challenge, no session)",
          content: json(z.union([SessionSchema, TwoFactorStepSchema])),
        },
        401: { description: "`invalid_challenge`: expired, already used, not for this step, or the person is switched off. Sign in again.", content: json(ErrorSchema) },
        422: { description: "The password breaks a rule (`weak_password`, saying which) or is the temporary one (`same_password`); nothing changed", content: json(z.union([WeakPasswordSchema, SamePasswordSchema])) },
      },
    },
    async (c) => {
      const body = c.req.valid("json");
      const result = await changeRequiredPassword(
        { db: c.env.DB, sessionSecret: c.env.SESSION_SECRET, auditKey: c.env.AUDIT_HMAC_KEY },
        { challenge: body.challenge, password: body.password, ip: c.req.header("CF-Connecting-IP") ?? null, userAgent: c.req.header("User-Agent") ?? null },
      );

      if (!result.ok) {
        if (result.reason === "weak_password") return c.json({ error: "weak_password" as const, problems: result.problems }, 422);
        if (result.reason === "same_password") return c.json({ error: "same_password" as const }, 422);
        return c.json({ error: "invalid_challenge" }, 401);
      }
      if (result.twoFactor) return c.json({ twoFactor: result.twoFactor, challenge: result.challenge }, 200);

      setSessionCookies(c, result.accessToken, result.refreshToken);
      return c.json({ user: result.user, roles: result.roles }, 200);
    },
  );
}
