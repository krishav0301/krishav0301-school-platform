import type { ApiClient } from "@/api/client";
import type { components } from "@/api/schema";

import type { FailReason } from "./model";

/**
 * What the People & Access screen asks of the server (D-099), as plain results. Nothing here throws: a dropped
 * connection is `failed`. A temporary password comes back only from creating someone, and is never kept here.
 */

export type PeoplePage = components["schemas"]["PeopleList"];
export type Person = components["schemas"]["Person"];
export type PeopleGroup = "admin" | "teaching";

export interface PeopleFilter {
  group: PeopleGroup;
  q?: string;
  role?: "coordinator" | "accountant";
  status?: "active" | "off";
  section?: string;
  programme?: string;
  page?: number;
  pageSize?: number;
}

export type PeopleResult = ({ ok: true } & PeoplePage) | { ok: false; reason: "forbidden" | "failed" };

/** One page of a list, searched and filtered on the server. */
export async function loadPeople(api: ApiClient, filter: PeopleFilter): Promise<PeopleResult> {
  const q = filter.q?.trim().slice(0, 100);
  try {
    const { data, response } = await api.GET("/api/people", {
      params: {
        query: {
          group: filter.group,
          ...(q && { q }),
          ...(filter.role && { role: filter.role }),
          ...(filter.status && { status: filter.status }),
          ...(filter.section && { section: filter.section }),
          ...(filter.programme && { programme: filter.programme }),
          ...(filter.page && { page: filter.page }),
          ...(filter.pageSize && { pageSize: filter.pageSize }),
        },
      },
    });
    if (data) return { ok: true, ...data };
    return { ok: false, reason: response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export type ProgrammeOption = { id: string; name: string; sectionKey: string };

/** The programmes, for the Teaching filter. An empty list when they cannot be read: the filter is then not offered. */
export async function loadProgrammeOptions(api: ApiClient): Promise<ProgrammeOption[]> {
  try {
    const { data } = await api.GET("/api/academics/programmes");
    return data ? data.programmes.map((p) => ({ id: p.id, name: p.name, sectionKey: p.section.key })) : [];
  } catch {
    return [];
  }
}

function reasonOf(status: number): FailReason {
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "email_taken";
  if (status === 400 || status === 422) return "rejected";
  return "failed";
}

export interface NewPerson {
  role: "coordinator" | "accountant";
  fullName: string;
  email: string;
  phone: string;
  /** Empty for the whole school. */
  sectionKeys: string[];
}

export type CreateResult = { ok: true; id: string; temporaryPassword: string } | { ok: false; reason: FailReason };

/** Gives someone administrative access: a Co-ordinator or an Accountant, for the whole school or some sections. */
export async function createPerson(api: ApiClient, person: NewPerson): Promise<CreateResult> {
  try {
    const { data, response } = await api.POST("/api/staff", {
      body: {
        fullName: person.fullName.trim(),
        email: person.email.trim(),
        ...(person.phone.trim() ? { phone: person.phone.trim() } : {}),
        role: person.role,
        sectionKeys: person.sectionKeys,
      },
    });
    return data ? { ok: true, id: data.id, temporaryPassword: data.temporaryPassword } : { ok: false, reason: reasonOf(response.status) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export type WriteResult = { ok: true } | { ok: false; reason: FailReason };

/** Changes where a Co-ordinator's or Accountant's access reaches: `[]` is the whole school. */
export async function setAccess(api: ApiClient, id: string, sectionKeys: string[]): Promise<WriteResult> {
  try {
    const { response } = await api.PATCH("/api/staff/{id}/access", { params: { path: { id } }, body: { sectionKeys } });
    return response.ok ? { ok: true } : { ok: false, reason: reasonOf(response.status) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
