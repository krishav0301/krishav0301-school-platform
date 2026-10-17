import type { components } from "@/api/schema";

import type { GateScanResult, PendingScan } from "./model";

export type DeviceList = components["schemas"]["GateDeviceList"];
export type GateOutcome =
  | { kind: "answer"; answer: GateScanResult }
  | { kind: "bad_key" }
  /** The server refused the tap itself (malformed number, or too old): resending would be refused again. */
  | { kind: "refused" }
  /** No answer: offline, or the server failed. The tap is kept and sent again. */
  | { kind: "offline" };

/**
 * The gate talks to the server with its own key in a header, not with a person's sign-in, so it uses plain `fetch`: the
 * signed-in client would try to renew a sign-in that does not exist when a 401 comes back.
 */
const headers = (key: string) => ({ "content-type": "application/json", "x-gate-key": key });

export async function sendScan(key: string, scan: PendingScan): Promise<GateOutcome> {
  try {
    const response = await fetch("/api/gate/scan", { method: "POST", headers: headers(key), body: JSON.stringify(scan), cache: "no-store" });
    if (response.ok) return { kind: "answer", answer: (await response.json()) as GateScanResult };
    if (response.status === 401) return { kind: "bad_key" };
    if (response.status === 422) return { kind: "refused" };
    return { kind: "offline" };
  } catch {
    return { kind: "offline" };
  }
}

export type CheckOutcome = { kind: "ok"; device: string } | { kind: "bad_key" } | { kind: "unreachable" };

/** Asks which device a key belongs to; the page opens with this. */
export async function checkKey(key: string): Promise<CheckOutcome> {
  try {
    const response = await fetch("/api/gate/me", { headers: { "x-gate-key": key }, cache: "no-store" });
    if (response.ok) return { kind: "ok", device: ((await response.json()) as components["schemas"]["GateDeviceMe"]).device.name };
    return response.status === 401 || response.status === 404 ? { kind: "bad_key" } : { kind: "unreachable" };
  } catch {
    return { kind: "unreachable" };
  }
}
