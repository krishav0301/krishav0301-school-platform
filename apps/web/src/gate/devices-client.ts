import type { ApiClient } from "@/api/client";

import type { DeviceList } from "./client";

export type DevicesLoad = { ok: true; data: DeviceList } | { ok: false; reason: "forbidden" | "failed" };
export type DeviceMade = { ok: true; id: string; name: string; key: string } | { ok: false; reason: "forbidden" | "failed" } | { ok: false; reason: "invalid"; message: string };

export async function loadDevices(api: ApiClient): Promise<DevicesLoad> {
  try {
    const { data, response } = await api.GET("/api/gate/devices");
    if (data) return { ok: true, data };
    return { ok: false, reason: response.status === 403 || response.status === 404 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function registerDevice(api: ApiClient, name: string): Promise<DeviceMade> {
  try {
    const { data, response, error } = await api.POST("/api/gate/devices", { body: { name } });
    if (data) return { ok: true, id: data.id, name: data.name, key: data.key };
    if (response.status === 422 && error && "message" in error) return { ok: false, reason: "invalid", message: error.message };
    return { ok: false, reason: response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function revokeDevice(api: ApiClient, id: string): Promise<boolean> {
  try {
    const { response } = await api.POST("/api/gate/devices/{id}/revoke", { params: { path: { id } } });
    return response.ok;
  } catch {
    return false;
  }
}
