import type { RoleClaim } from "../tokens";
import { MATRIX, ROLE_CODES, ROLE_OF, rowFor, type ActionId, type RoleCode } from "./matrix";

/**
 * What a person may reach with an action. Handlers use it to build their queries: this is how
 * "Student A cannot open Student B's fees" and "a section-scoped Co-ordinator sees only their
 * section" are enforced. The grant says how far; the handler applies it.
 */
export interface Grant {
  /** The whole institution. */
  institution: boolean;
  /** Only these sections (keys), for section-scoped roles. Empty when `institution` is true. */
  sections: string[];
  /** The person's own record. */
  own: boolean;
  /** Their assigned subjects or classes. */
  assigned: boolean;
  /** Their own class (Class Teacher). */
  classOnly: boolean;
  /** Plain-words restrictions the handler must enforce. */
  limits: string[];
  /** True when every role that grants this may only look. */
  readOnly: boolean;
  /** The action is open to anyone; nothing needs narrowing. */
  anonymous: boolean;
}

const CODE_OF_ROLE = Object.fromEntries(ROLE_CODES.map((code) => [ROLE_OF[code], code])) as Record<string, RoleCode>;

/**
 * The person's grant for an action, or null: denied. Deny by default: an unknown action, an
 * unknown role, or a role not listed for the action is denied. With several roles the grants
 * combine, and the widest wins.
 */
export function authorize(roles: readonly RoleClaim[], action: ActionId | string): Grant | null {
  const row = rowFor(action);
  if (!row) return null;

  if (row.anonymous) {
    return { institution: false, sections: [], own: false, assigned: false, classOnly: false, limits: [], readOnly: false, anonymous: true };
  }

  const grant: Grant = { institution: false, sections: [], own: false, assigned: false, classOnly: false, limits: [], readOnly: true, anonymous: false };
  let granted = false;

  for (const claim of roles) {
    const code = CODE_OF_ROLE[claim.role];
    const cell = code ? row.cells[code] : undefined;
    if (!cell) continue;

    switch (cell.reach) {
      case "all":
        grant.institution = true;
        break;
      case "inst":
        if (claim.scope === "institution") grant.institution = true;
        else if (claim.scope === "section" && claim.section) {
          if (!grant.sections.includes(claim.section)) grant.sections.push(claim.section);
        } else continue; // an institution-reach action needs an institution or section assignment
        break;
      case "own":
        grant.own = true;
        break;
      case "assigned":
        grant.assigned = true;
        break;
      case "class":
        grant.classOnly = true;
        break;
    }
    granted = true;
    if (cell.limit && !grant.limits.includes(cell.limit)) grant.limits.push(cell.limit);
    if (!cell.readOnly) grant.readOnly = false;
  }

  if (!granted) return null;
  if (grant.institution) grant.sections = []; // the whole institution already covers every section
  return grant;
}

/** May this grant touch data in that section? Institution-wide yes; section-scoped only their own. */
export function canAccessSection(grant: Grant, sectionKey: string): boolean {
  return grant.institution || grant.sections.includes(sectionKey);
}

/** For query building: every section, or just these. */
export function allowedSections(grant: Grant): "all" | readonly string[] {
  return grant.institution ? "all" : grant.sections;
}

export const ALL_ACTIONS: readonly ActionId[] = MATRIX.map((r) => r.id);
