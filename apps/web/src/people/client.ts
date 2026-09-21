import type { ApiClient } from "@/api/client";

import type { FailReason, StaffFormValues } from "./model";

/**
 * Everything the People screens ask of the server, as plain results. Nothing here throws: a dropped connection is
 * `failed`. A temporary password comes back only from the two calls that make one, and is never kept here.
 */

export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "forbidden" | "failed" };

export async function loadStaff(api: ApiClient): Promise<Loaded<{ staff: import("./model").StaffMember[] }>> {
  try {
    const { data, response } = await api.GET("/api/staff");
    if (data) return { ok: true, data };
    return { ok: false, reason: response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

function reasonOf(response: Response): FailReason {
  const status = response.status;
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "email_taken";
  if (status === 400 || status === 422) return "rejected";
  return "failed";
}

export type CreateResult = { ok: true; id: string; temporaryPassword: string } | { ok: false; reason: FailReason };
export type WriteResult = { ok: true } | { ok: false; reason: FailReason };
export type PasswordResult = { ok: true; temporaryPassword: string } | { ok: false; reason: FailReason };

const optionalPhone = (phone: string) => (phone.trim() ? { phone: phone.trim() } : {});

/** Adds a Co-ordinator or an Accountant. No section means the whole school. */
export async function createStaff(api: ApiClient, values: StaffFormValues & { role: "coordinator" | "accountant" }): Promise<CreateResult> {
  try {
    const { data, response } = await api.POST("/api/staff", {
      body: { fullName: values.fullName.trim(), email: values.email.trim(), ...optionalPhone(values.phone), role: values.role, sectionKey: values.sectionKey || null },
    });
    return data ? { ok: true, id: data.id, temporaryPassword: data.temporaryPassword } : { ok: false, reason: reasonOf(response) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Adds a teacher with a home section. */
export async function createTeacher(api: ApiClient, values: Pick<StaffFormValues, "fullName" | "email" | "phone" | "sectionKey">): Promise<CreateResult> {
  try {
    const { data, response } = await api.POST("/api/teachers", {
      body: { fullName: values.fullName.trim(), email: values.email.trim(), ...optionalPhone(values.phone), homeSectionKey: values.sectionKey },
    });
    return data ? { ok: true, id: data.id, temporaryPassword: data.temporaryPassword } : { ok: false, reason: reasonOf(response) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function setStaffActive(api: ApiClient, id: string, active: boolean): Promise<WriteResult> {
  try {
    const { response } = await api.PATCH("/api/staff/{id}", { params: { path: { id } }, body: { active } });
    return response.ok ? { ok: true } : { ok: false, reason: reasonOf(response) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function issueTemporaryPassword(api: ApiClient, id: string): Promise<PasswordResult> {
  try {
    const { data, response } = await api.POST("/api/staff/{id}/temporary-password", { params: { path: { id } } });
    return data ? { ok: true, temporaryPassword: data.temporaryPassword } : { ok: false, reason: reasonOf(response) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
