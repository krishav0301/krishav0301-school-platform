export const ROLES = ["student", "teacher", "coordinator", "accountant", "admin", "super_admin"] as const;
export type Role = (typeof ROLES)[number];

/** How a role assignment is bounded (D-004). The database only allows sensible pairs. */
export const SCOPES = ["own", "assigned", "section", "institution"] as const;
export type Scope = (typeof SCOPES)[number];
