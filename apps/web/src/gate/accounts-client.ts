import type { ApiClient } from "@/api/client";

import type { AccountList, IssuedLogin } from "./client";

export type AccountsLoad = { ok: true; data: AccountList } | { ok: false; reason: "forbidden" | "failed" };
export type LoginMade = { ok: true; login: IssuedLogin } | { ok: false; reason: "forbidden" | "failed" } | { ok: false; reason: "invalid"; message: string };

export async function loadAccounts(api: ApiClient): Promise<AccountsLoad> {
  try {
    const { data, response } = await api.GET("/api/gate/accounts");
    if (data) return { ok: true, data };
    return { ok: false, reason: response.status === 403 || response.status === 404 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function createAccount(api: ApiClient, name: string): Promise<LoginMade> {
  try {
    const { data, response, error } = await api.POST("/api/gate/accounts", { body: { name } });
    if (data) return { ok: true, login: data };
    if (response.status === 422 && error && "message" in error) return { ok: false, reason: "invalid", message: error.message };
    return { ok: false, reason: response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function newLogin(api: ApiClient, id: string): Promise<LoginMade> {
  try {
    const { data, response } = await api.POST("/api/gate/accounts/{id}/new-login", { params: { path: { id } } });
    if (data) return { ok: true, login: data };
    return { ok: false, reason: response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function disableAccount(api: ApiClient, id: string): Promise<boolean> {
  try {
    const { response } = await api.POST("/api/gate/accounts/{id}/disable", { params: { path: { id } } });
    return response.ok;
  } catch {
    return false;
  }
}

export async function signOutComputer(api: ApiClient, id: string): Promise<boolean> {
  try {
    const { response } = await api.POST("/api/gate/computers/{id}/revoke", { params: { path: { id } } });
    return response.ok;
  } catch {
    return false;
  }
}
