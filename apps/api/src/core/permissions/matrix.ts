/**
 * THE permission matrix: who may do what. The one place permissions are decided.
 *
 * `docs/permission-matrix.md` shows these tables, generated from this file (`npm run gen:permissions`);
 * CI fails if they drift. Deny by default: a role that is not listed for an action is denied.
 *
 * Cells say how far a role's grant reaches:
 *   all       everything, the whole institution (Admin, Super Admin)
 *   inst      the institution, narrowed to one section if the role assignment is section-scoped (D-004)
 *   read      like `inst`, for a role that may only look
 *   own       the person's own record
 *   assigned  their assigned subjects or classes
 *   class     their own class (the Class Teacher)
 * A cell may also carry a `limit`, a plain-words restriction the handler must enforce.
 */
import type { Role } from "../roles";

export type RoleCode = "STU" | "TEA" | "COO" | "ACC" | "ADM" | "SUP";
export const ROLE_OF: Record<RoleCode, Role> = {
  STU: "student",
  TEA: "teacher",
  COO: "coordinator",
  ACC: "accountant",
  ADM: "admin",
  SUP: "super_admin",
};
export const ROLE_CODES = Object.keys(ROLE_OF) as RoleCode[];

export type Reach = "all" | "inst" | "own" | "assigned" | "class";

export interface Cell {
  reach: Reach;
  readOnly?: boolean;
  /** A restriction in plain words that the handler must enforce. */
  limit?: string;
  /** How the cell reads in the generated document. */
  show?: string;
}

const all: Cell = { reach: "all" };
const inst: Cell = { reach: "inst" };
const read: Cell = { reach: "inst", readOnly: true, show: "read" };
const own: Cell = { reach: "own" };
const assigned: Cell = { reach: "assigned" };
const cls: Cell = { reach: "class" };
const only = (base: Cell, limit: string, show = limit): Cell => ({ ...base, limit, show });

export interface Row<Id extends string = string> {
  id: Id;
  group: string;
  label: string;
  phase: number;
  /** Anyone may do this, signed in or not. The cells are for display only. */
  anonymous?: boolean;
  cells: Partial<Record<RoleCode, Cell>>;
  /** For anonymous rows: how each column reads in the document. */
  display?: Partial<Record<RoleCode, string>>;
}

function row<const Id extends string>(
  group: string,
  id: Id,
  label: string,
  phase: number,
  cells: Partial<Record<RoleCode, Cell>>,
  extra: { anonymous?: boolean; display?: Partial<Record<RoleCode, string>> } = {},
): Row<Id> {
  return { id, group, label, phase, cells, ...extra };
}

export const GROUP_NOTES: Record<string, string> = {
  "Fees and money": "The Co-ordinator has **no** fees access at all.",
};

const G = {
  access: "Access and accounts",
  site: "Public website",
  setup: "Setup",
  people: "Admissions and students",
  life: "Daily school life",
  fees: "Fees and money",
  results: "Marks and results",
  oversight: "Oversight",
} as const;

export const MATRIX = [
  // --- Access and accounts
  row(G.access, "auth.sign_in", "Sign in, reset own password", 1, { STU: all, TEA: all, COO: all, ACC: all, ADM: all, SUP: all }),
  row(G.access, "accounts.admin.create", "Create Admin account", 1, { SUP: all }),
  row(G.access, "accounts.staff.create", "Create Co-ordinator or Accountant", 1, { ADM: all, SUP: all }),
  row(G.access, "accounts.teacher.create", "Create Teacher", 3, { COO: inst, SUP: all }),
  row(G.access, "accounts.deactivate", "Deactivate or reactivate an account", 1, {
    COO: only(inst, "teachers"),
    ADM: only(all, "co-ordinators, accountants"),
    SUP: all,
  }),
  row(G.access, "accounts.staff.view", "View the staff list", 3, { COO: only(inst, "teachers"), ADM: read, SUP: all }),
  row(G.access, "accounts.password.issue", "Give a person a new temporary password", 3, {
    COO: only(inst, "teachers"),
    ADM: only(all, "co-ordinators, accountants"),
    SUP: all,
  }),
  row(G.access, "accounts.reset_2fa", "Reset lost 2FA", 1, { SUP: all }),
  row(G.access, "branding.manage", "Change branding, signature, seal", 1, { SUP: all }),
  row(G.access, "demo.switch_persona", "Switch persona (demo mode only, logged)", 1, { SUP: all }),

  // --- Public website
  row(G.site, "site.view", "View public site (anyone, no sign-in)", 2, {}, {
    anonymous: true,
    display: { STU: "✓", TEA: "✓", COO: "✓", ACC: "✓", ADM: "✓", SUP: "✓" },
  }),
  row(G.site, "content.draft", "Draft content (notice, holiday, routine, vacancy, post)", 2, { COO: inst, ADM: all, SUP: all }),
  row(G.site, "content.publish", "Publish content directly", 2, { ADM: all, SUP: all }),

  // --- Setup
  row(G.setup, "setup.structure.manage", "Manage academic years, programmes, levels, classes, terminals", 3, { COO: inst, SUP: all }),
  row(G.setup, "setup.structure.view", "View academic years, programmes, levels, classes, terminals", 3, { COO: inst, ADM: read, SUP: all }),
  row(G.setup, "setup.subjects.view", "View subjects, offerings, mark components, elective groups", 3, { COO: inst, ADM: read, SUP: all }),
  row(G.setup, "setup.subjects.manage", "Manage subjects, offerings, mark components, elective groups", 3, { COO: inst, SUP: all }),
  row(G.setup, "setup.assignments.view", "View teacher assignments and Class Teachers", 3, { COO: inst, ADM: read, SUP: all }),
  row(G.setup, "setup.assignments.manage", "Assign teachers to subjects; pick the Class Teacher", 3, { COO: inst, SUP: all }),

  // --- Admissions and students
  row(G.people, "admissions.apply", "Submit an application (anonymous, rate limited)", 4, {}, {
    anonymous: true,
    display: { STU: "public", TEA: "—", COO: "—", ACC: "—", ADM: "—", SUP: "—" },
  }),
  row(G.people, "admissions.walkin.register", "Register a walk-in (auto-approved)", 4, { COO: inst, SUP: all }),
  row(G.people, "admissions.student.register", "Register a student (goes to the review queue)", 4, { ACC: inst }),
  row(G.people, "admissions.review", "Review queue: approve, ask for changes, reject", 4, { COO: inst, SUP: all }),
  row(G.people, "students.search", "Search students", 4, { TEA: only(assigned, "sid+name", "sid+name (assigned)"), COO: inst, ACC: inst, ADM: inst, SUP: all }),
  row(G.people, "students.personal.view", "View personal details", 4, { STU: own, COO: inst, ACC: read, ADM: read, SUP: all }),
  row(G.people, "students.personal.correct", "Correct personal details (reason required; SID never editable)", 4, { COO: inst, SUP: all }),
  row(G.people, "students.status.set", "Mark Left or Graduated (zero dues only)", 8, { COO: inst, SUP: all }),
  row(G.people, "students.rollover", "Year rollover: Promote, Repeat, Leaving", 8, { COO: inst, SUP: all }),

  // --- Daily school life
  row(G.life, "attendance.student.mark", "Mark student attendance (once a day, same-day edits)", 5, { TEA: cls }),
  row(G.life, "attendance.student.view", "View student attendance", 5, { STU: own, TEA: cls, COO: inst, ADM: read, SUP: all }),
  row(G.life, "attendance.teacher.mark", "Mark teacher attendance (past days editable with reason)", 5, { COO: inst, SUP: all }),
  row(G.life, "attendance.teacher.view", "View teacher attendance", 5, { TEA: own, COO: inst, ADM: read, SUP: all }),
  row(G.life, "activity.write", "Write daily activity log", 5, { TEA: assigned }),
  row(G.life, "activity.read", "Read daily activity log", 5, { STU: only(own, "own class"), TEA: assigned, COO: inst, ADM: read, SUP: all }),
  row(G.life, "notes.manage", "Upload or delete notes and question papers", 5, { TEA: assigned }),
  row(G.life, "notes.view", "View notes and question papers (watermarked, no download)", 5, { STU: only(own, "own class"), TEA: assigned }),
  row(G.life, "assignments.manage", "Create and grade assignments", 5, { TEA: assigned }),
  row(G.life, "assignments.submit", "Submit an assignment", 5, { STU: own }),

  // --- Fees and money
  row(G.fees, "fees.structure.draft", "Draft yearly fee structure", 6, { ACC: inst }),
  row(G.fees, "fees.structure.approve", "Approve fee structure", 6, { ADM: all }),
  row(G.fees, "fees.charges.generate", "Generate the year's charges from a live fee structure", 6, { ACC: inst }),
  row(G.fees, "fees.view", "View fees, dues, ledger", 6, { STU: own, ACC: inst, ADM: read, SUP: all }),
  row(G.fees, "fees.voucher.upload", "Upload a payment voucher", 6, { STU: own }),
  row(G.fees, "fees.online.pay", "Pay online through the gateway (demo adapter only until Phase 9)", 6, { STU: own }),
  row(G.fees, "fees.voucher.verify", "Verify or reject a voucher", 6, { ACC: inst }),
  row(G.fees, "fees.cash.record", "Record cash payment", 6, { ACC: inst }),
  row(G.fees, "fees.discount.propose", "Propose a discount", 6, { ACC: inst }),
  row(G.fees, "fees.discount.approve", "Approve a discount", 6, { ADM: all }),
  row(G.fees, "fees.reversal.request", "Request a payment reversal", 6, { ACC: inst }),
  row(G.fees, "fees.reversal.approve", "Approve a reversal", 6, { ADM: all }),
  row(G.fees, "fees.refund.request", "Request a refund", 6, { ACC: inst }),
  row(G.fees, "fees.refund.approve", "Approve a refund", 6, { ADM: all }),
  row(G.fees, "fees.refund.record", "Record how an approved refund was paid", 6, { ACC: inst }),
  row(G.fees, "fees.receipts.view", "View and download receipts", 6, { STU: own, ACC: inst, ADM: read, SUP: all }),
  row(G.fees, "fees.reminders.send", "Send overdue reminders (email)", 6, { ACC: inst }),

  // --- Marks and results
  row(G.results, "results.electives.set", "Record each student's elective picks (D-056)", 7, { COO: inst, SUP: all }),
  row(G.results, "marks.enter", "Enter marks (until verified)", 7, { TEA: assigned }),
  row(G.results, "marks.verify", "Verify, send back, bulk approve", 7, { COO: inst, SUP: all }),
  row(G.results, "results.publish", "Publish a whole class (all subjects verified)", 7, { COO: inst, SUP: all }),
  row(G.results, "results.view", "View published results and marks card", 7, { STU: own, COO: inst, ADM: read, SUP: all }),
  row(G.results, "results.top20.view", "Top 20", 7, {
    STU: only(own, "name and rank only, own section, published"),
    COO: inst,
    ADM: inst,
    SUP: all,
  }),
  row(G.results, "results.recheck.request", "Request a recheck", 7, { STU: own }),
  row(G.results, "results.recheck.edit", "Edit and republish after recheck", 7, { COO: inst, SUP: all }),

  // --- Oversight
  row(G.oversight, "approvals.decide", "Approvals inbox: decide (never your own request)", 3, { ADM: all, SUP: all }),
  row(G.oversight, "approvals.request", "Send a draft for approval", 3, { COO: inst, ADM: all, SUP: all }),
  row(G.oversight, "approvals.view.own", "View your own approval requests", 3, { COO: own }),
  row(G.oversight, "audit.view", "View activity audit trail and sign-ins", 1, { ADM: all, SUP: all }),
  row(G.oversight, "audit.edit", "Edit or delete an audit entry", 1, {}),
  row(G.oversight, "dev.mailbox.view", "Test mailbox: read the emails the site would have sent (only where email is not really sent; never in production)", 7, { ADM: all, SUP: all }),
  row(G.oversight, "reports.students", "Reports and Excel export (students)", 4, { COO: inst, ADM: inst, SUP: all }),
  row(G.oversight, "reports.fees", "Reports and Excel export (fees)", 6, { ACC: inst, ADM: inst, SUP: all }),
  row(G.oversight, "reports.results", "Reports and Excel export (results)", 7, { COO: inst, ADM: inst, SUP: all }),
] as const;

export type ActionId = (typeof MATRIX)[number]["id"];

const BY_ID = new Map<string, Row>(MATRIX.map((r) => [r.id, r]));

export const isKnownAction = (id: string): id is ActionId => BY_ID.has(id);
export const rowFor = (id: string): Row | undefined => BY_ID.get(id);

/** The cell text for the generated document. */
export function showCell(r: Row, code: RoleCode): string {
  if (r.display?.[code]) return r.display[code]!;
  const cell = r.cells[code];
  if (!cell) return "—";
  if (cell.show) return cell.show;
  if (cell.limit) return cell.limit;
  return { all: "✓", inst: "inst", own: "own", assigned: "assigned", class: "class" }[cell.reach];
}
