import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { defineRoute } from "../../core/routes";
import type { App, AppEnv } from "../../core/types";
import { createAccount, disableAccount, listAccounts, reissueLogin, revokeComputer, type AccountResult } from "./accounts";
import { deviceByKey } from "./keys";
import { recordScan } from "./scan";
import { AccountBodySchema, AccountListSchema, IssuedLoginSchema, MeSchema, PublicIdSchema, ScanBodySchema, ScanResponseSchema, SignInBodySchema, SignInResponseSchema } from "./schema";
import { signInGate } from "./signin";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const ErrorSchema = z.object({ error: z.string() }).openapi("GateError");
const InvalidSchema = z.object({ error: z.literal("invalid"), message: z.string() }).openapi("GateInvalid");
const OkSchema = z.object({ ok: z.literal(true) }).openapi("GateOk");
const IdParam = z.object({ id: PublicIdSchema });

const KEY_HEADER = "x-gate-key";
const keyOf = (c: Context<AppEnv>): string => c.req.header(KEY_HEADER) ?? "";

/** Turns an account result into the documented answer (the cast is because one function serves several routes' answer types). */
function issued(c: Context<AppEnv>, result: AccountResult, status: 200 | 201): never {
  c.header("Cache-Control", "no-store");
  if (result.ok) return c.json({ id: result.id, name: result.name, gateId: result.gateId, password: result.password, authenticator: result.authenticator }, status) as never;
  if (result.reason === "invalid") return c.json({ error: "invalid" as const, message: result.message }, 422) as never;
  return c.json({ error: result.reason === "not_found" ? "not_found" : "forbidden" }, result.reason === "not_found" ? 404 : 403) as never;
}

/**
 * The gate (D-175, D-176): the accounts people at the gate sign in with, the computers signed in, and the card taps they
 * send. A computer signs in with its account's special ID, password and authenticator code, and holds a secret key from
 * then on; the taps and the key check are public routes that carry that key in a header, not a person's session.
 * Everything here is "not found" while the school's `card_attendance` module is off.
 */
export function registerGate(app: App): void {
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/gate/accounts",
      operationId: "list_gate_accounts",
      tags: ["gate"],
      description: "The gate accounts, newest first, each with the computers signed in with it and when each last sent a tap. Never a password, a secret or a key.",
      access: { action: "gate.manage" },
      responses: { 200: { description: "The gate accounts", content: json(AccountListSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await listAccounts(c.env.DB), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/gate/accounts",
      operationId: "create_gate_account",
      tags: ["gate"],
      description:
        "Makes a gate account: a special ID, a password and an authenticator, all made by the server and shown once, never again. Any number of computers can sign in with it at /gate.",
      access: { action: "gate.manage" },
      request: { body: { required: true, content: json(AccountBodySchema) } },
      responses: {
        201: { description: "Made, with its login (never cached)", content: json(IssuedLoginSchema) },
        403: { description: "Not allowed", content: json(ErrorSchema) },
        422: { description: "The name is missing or too long", content: json(InvalidSchema) },
      },
    },
    async (c) => issued(c, await createAccount(c.env.DB, c.env.AUDIT_HMAC_KEY, c.env.DATA_KEY, c.get("auth")!.userPublicId, c.req.valid("json")), 201),
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/gate/accounts/{id}/new-login",
      operationId: "reissue_gate_login",
      tags: ["gate"],
      description: "Gives an account a new password and a new authenticator, shown once, and signs out every computer signed in with it: for a lost password or phone.",
      access: { action: "gate.manage" },
      request: { params: IdParam },
      responses: {
        200: { description: "The new login (never cached)", content: json(IssuedLoginSchema) },
        403: { description: "Not allowed", content: json(ErrorSchema) },
        404: { description: "No such active gate account", content: json(ErrorSchema) },
      },
    },
    async (c) => issued(c, await reissueLogin(c.env.DB, c.env.AUDIT_HMAC_KEY, c.env.DATA_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id), 200),
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/gate/accounts/{id}/disable",
      operationId: "disable_gate_account",
      tags: ["gate"],
      description: "Disables a gate account for good. It can no longer sign in, and every computer signed in with it stops at once.",
      access: { action: "gate.manage" },
      request: { params: IdParam },
      responses: { 200: { description: "Disabled", content: json(OkSchema) }, 404: { description: "No such active gate account", content: json(ErrorSchema) } },
    },
    async (c) => {
      const result = await disableAccount(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id);
      return result.ok ? c.json({ ok: true as const }, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/gate/computers/{id}/revoke",
      operationId: "revoke_gate_computer",
      tags: ["gate"],
      description: "Signs one computer out of the gate. Its key stops working at once; it can sign in again with the account's login.",
      access: { action: "gate.manage" },
      request: { params: IdParam },
      responses: { 200: { description: "Signed out", content: json(OkSchema) }, 404: { description: "No such signed-in computer", content: json(ErrorSchema) } },
    },
    async (c) => {
      const result = await revokeComputer(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id);
      return result.ok ? c.json({ ok: true as const }, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/gate/sign-in",
      operationId: "sign_in_gate",
      tags: ["gate"],
      description:
        "A computer signs in to the gate with an account's special ID, its password and the code from its authenticator app. The answer carries the computer's secret key, which the gate page keeps. A code works once. Wrong ID, password and code all answer the same.",
      access: { public: true },
      request: { body: { required: true, content: json(SignInBodySchema) } },
      responses: {
        200: { description: "Signed in, with the computer's key (never cached)", content: json(SignInResponseSchema) },
        401: { description: "The ID, password or code is wrong", content: json(ErrorSchema) },
        429: { description: "Too many recent failed attempts", content: json(ErrorSchema) },
      },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const body = c.req.valid("json");
      const result = await signInGate(c.env.DB, c.env.DATA_KEY, { ...body, ip: c.req.header("CF-Connecting-IP") ?? null, userAgent: c.req.header("User-Agent") ?? null });
      if (result.ok) return c.json({ key: result.key, account: result.account, computer: result.computer }, 200);
      if (result.reason === "throttled") {
        c.header("Retry-After", String(15 * 60));
        return c.json({ error: "too_many_attempts" }, 429);
      }
      return c.json({ error: "invalid_credentials" }, 401);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/gate/me",
      operationId: "get_gate_computer",
      tags: ["gate"],
      description: "Which gate account and computer the key in the `x-gate-key` header belongs to; the gate page asks this when it opens.",
      access: { public: true },
      responses: { 200: { description: "The computer", content: json(MeSchema) }, 401: { description: "The key is missing, wrong or revoked", content: json(ErrorSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const device = await deviceByKey(c.env.DB, keyOf(c));
      return device ? c.json({ account: device.name, computer: device.label }, 200) : c.json({ error: "bad_key" }, 401);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/gate/scan",
      operationId: "record_gate_scan",
      tags: ["gate"],
      description:
        "One card tap from a gate computer (key in the `x-gate-key` header). Always recorded. A first tap on a school day marks the student or teacher Present; a repeat changes nothing; an unknown, retired or inactive card marks nothing. The same `scanId` again is the same tap and gets the same answer.",
      access: { public: true },
      request: { body: { required: true, content: json(ScanBodySchema) } },
      responses: {
        200: { description: "What the screen shows", content: json(ScanResponseSchema) },
        401: { description: "The key is missing, wrong or revoked", content: json(ErrorSchema) },
        422: { description: "The card number or scan id is malformed, or the tap is more than a week old", content: json(InvalidSchema) },
      },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const out = await recordScan(c.env.DB, keyOf(c), c.req.valid("json"));
      if (out.rejected === "bad_key") return c.json({ error: "bad_key" }, 401);
      if (out.rejected) return c.json({ error: "invalid" as const, message: out.message ?? "That is not valid" }, 422);
      return c.json({ result: out.result!, person: out.person, at: out.at, firstAt: out.firstAt }, 200);
    },
  );
}
