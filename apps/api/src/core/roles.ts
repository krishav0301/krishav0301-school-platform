export type Role = "student" | "teacher" | "coordinator" | "accountant" | "admin" | "super_admin";

/** How a role assignment is bounded (D-004). The database only allows sensible pairs. */
export type Scope = "own" | "assigned" | "section" | "institution";
