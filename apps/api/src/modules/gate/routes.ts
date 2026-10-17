import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { defineRoute } from "../../core/routes";
import type { App, AppEnv } from "../../core/types";
import { deviceByKey, listDevices, registerDevice, revokeDevice } from "./devices";
import { recordScan } from "./scan";
import { DeviceBodySchema, DeviceCreatedSchema, DeviceListSchema, DeviceMeSchema, PublicIdSchema, ScanBodySchema, ScanResponseSchema } from "./schema";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const ErrorSchema = z.object({ error: z.string() }).openapi("GateError");
const InvalidSchema = z.object({ error: z.literal("invalid"), message: z.string() }).openapi("GateInvalid");
const OkSchema = z.object({ ok: z.literal(true) }).openapi("GateOk");
const IdParam = z.object({ id: PublicIdSchema });

const KEY_HEADER = "x-gate-key";
const keyOf = (c: Context<AppEnv>): string => c.req.header(KEY_HEADER) ?? "";

/**
 * The gate (D-175): registering the computers at the school gate, and taking the card taps they send. The taps and the
 * check that a gate computer is who it says are public routes: they carry the device's secret key in a header, not a
 * person's sign-in. Everything here is "not found" while the school's `card_attendance` module is off.
 */
export function registerGate(app: App): void {
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/gate/devices",
      operationId: "list_gate_devices",
      tags: ["gate"],
      description: "The registered gate computers, newest first, with when each last sent a tap. Never a key.",
      access: { action: "gate.manage" },
      responses: { 200: { description: "The gate computers", content: json(DeviceListSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await listDevices(c.env.DB), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/gate/devices",
      operationId: "register_gate_device",
      tags: ["gate"],
      description: "Registers a gate computer. The answer carries its secret key, shown once and never again: it is typed into the gate page on that computer.",
      access: { action: "gate.manage" },
      request: { body: { required: true, content: json(DeviceBodySchema) } },
      responses: {
        201: { description: "Registered, with the key (never cached)", content: json(DeviceCreatedSchema) },
        403: { description: "Not allowed", content: json(ErrorSchema) },
        422: { description: "The name is missing or too long", content: json(InvalidSchema) },
      },
    },
    async (c) => {
      const result = await registerDevice(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      c.header("Cache-Control", "no-store");
      if (result.ok) return c.json({ id: result.id, name: result.name, key: result.key }, 201);
      if (result.reason === "invalid") return c.json({ error: "invalid" as const, message: result.message }, 422);
      return c.json({ error: "forbidden" }, 403);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/gate/devices/{id}/revoke",
      operationId: "revoke_gate_device",
      tags: ["gate"],
      description: "Revokes a gate computer for good. Its key stops working at once.",
      access: { action: "gate.manage" },
      request: { params: IdParam },
      responses: { 200: { description: "Revoked", content: json(OkSchema) }, 404: { description: "No such active gate computer", content: json(ErrorSchema) } },
    },
    async (c) => {
      const result = await revokeDevice(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id);
      return result.ok ? c.json({ ok: true as const }, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/gate/me",
      operationId: "get_gate_device",
      tags: ["gate"],
      description: "Which gate computer the key in the `x-gate-key` header belongs to; the gate page asks this when it opens.",
      access: { public: true },
      responses: { 200: { description: "The device", content: json(DeviceMeSchema) }, 401: { description: "The key is missing, wrong or revoked", content: json(ErrorSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const device = await deviceByKey(c.env.DB, keyOf(c));
      return device ? c.json({ device: { name: device.name } }, 200) : c.json({ error: "bad_key" }, 401);
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
