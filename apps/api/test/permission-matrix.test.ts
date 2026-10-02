import { describe, expect, it } from "vitest";

import {
  ALL_ACTIONS,
  GROUP_NOTES,
  MATRIX,
  ROLE_CODES,
  ROLE_OF,
  allowedSections,
  authorize,
  canAccessSection,
  isKnownAction,
  rowFor,
  type RoleCode,
} from "../src/core/permissions";
import type { RoleClaim } from "../src/core/tokens";

const SCOPE_OF: Record<RoleCode, RoleClaim["scope"]> = {
  STU: "own", TEA: "assigned", COO: "institution", ACC: "institution", ADM: "institution", SUP: "institution",
};
const claim = (code: RoleCode): RoleClaim => ({ role: ROLE_OF[code], scope: SCOPE_OF[code] });
const allowedBy = (action: string): RoleCode[] => ROLE_CODES.filter((code) => authorize([claim(code)], action) !== null);

// ---------------------------------------------------------------------------------------------
// Part 1. One test per row, generated from the matrix. It proves the code does what the table says.
// ---------------------------------------------------------------------------------------------
describe("every row of the matrix does what its cells say", () => {
  it.each(MATRIX.map((r) => [r.id, r] as const))("%s", (_id, row) => {
    for (const code of ROLE_CODES) {
      const grant = authorize([claim(code)], row.id);

      if (row.anonymous) {
        expect(grant?.anonymous, `${code} on anonymous ${row.id}`).toBe(true);
        continue;
      }

      const cell = row.cells[code];
      if (!cell) {
        expect(grant, `${code} must be denied ${row.id}`).toBeNull();
        continue;
      }

      expect(grant, `${code} must be allowed ${row.id}`).not.toBeNull();
      expect(grant!.institution, `${code} ${row.id} institution`).toBe(cell.reach === "all" || cell.reach === "inst");
      expect(grant!.own, `${code} ${row.id} own`).toBe(cell.reach === "own");
      expect(grant!.assigned, `${code} ${row.id} assigned`).toBe(cell.reach === "assigned");
      expect(grant!.classOnly, `${code} ${row.id} class`).toBe(cell.reach === "class");
      expect(grant!.readOnly, `${code} ${row.id} readOnly`).toBe(cell.readOnly === true);
      expect(grant!.limits, `${code} ${row.id} limits`).toEqual(cell.limit ? [cell.limit] : []);
    }
  });

  it("no action id is repeated, and every one is a dotted name", () => {
    expect(new Set(ALL_ACTIONS).size).toBe(ALL_ACTIONS.length);
    for (const id of ALL_ACTIONS) expect(id).toMatch(/^[a-z_0-9]+(\.[a-z_0-9]+)+$/);
  });

  it("every group note belongs to a real group", () => {
    const groups = new Set(MATRIX.map((r) => r.group));
    for (const group of Object.keys(GROUP_NOTES)) expect(groups.has(group), group).toBe(true);
  });

  it("every action is dated to a build phase from 1 to 8", () => {
    for (const row of MATRIX) expect(row.phase, row.id).toBeGreaterThanOrEqual(1);
    for (const row of MATRIX) expect(row.phase, row.id).toBeLessThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------------------------
// Part 2. Written by hand, independent of the matrix data. If someone edits a cell and gets a
// sensitive rule wrong, these fail. They restate rules from the requirements, not from the table.
// ---------------------------------------------------------------------------------------------
describe("sensitive rules, stated independently (docs/source/sample-creation-information.md)", () => {
  const exactly: Record<string, RoleCode[]> = {
    // Only an Admin approves anything that changes money or the public site.
    "fees.structure.approve": ["ADM"],
    "fees.discount.approve": ["ADM"],
    "fees.reversal.approve": ["ADM"],
    "fees.refund.approve": ["ADM"],
    "approvals.decide": ["ADM", "SUP"],
    "approvals.request": ["COO", "ADM", "SUP"],
    // The Accountant owns fees and payments. Nobody else touches them.
    "fees.structure.draft": ["ACC"],
    "fees.voucher.verify": ["ACC"],
    "fees.cash.record": ["ACC"],
    "fees.discount.propose": ["ACC"],
    "fees.reversal.request": ["ACC"],
    "fees.refund.request": ["ACC"],
    "fees.refund.record": ["ACC"],
    // The audit log is read by Admins and Super Admin, and edited by nobody at all.
    "audit.view": ["ADM", "SUP"],
    "audit.edit": [],
    // Only the Co-ordinator approves students. Admin does not register students or create teachers.
    "admissions.review": ["COO", "SUP"],
    "admissions.walkin.register": ["COO", "SUP"],
    "admissions.student.register": ["ACC"],
    "accounts.teacher.create": ["COO", "SUP"],
    "accounts.staff.create": ["ADM", "SUP"],
    "accounts.admin.create": ["SUP"],
    "accounts.reset_2fa": ["SUP"],
    "branding.manage": ["SUP"],
    // Results: teachers enter, the Co-ordinator verifies and publishes.
    "marks.enter": ["TEA"],
    "marks.verify": ["COO", "SUP"],
    "results.publish": ["COO", "SUP"],
    // A recheck is the student's to ask and the Co-ordinator's to decide; the Co-ordinator also records elective picks (D-056).
    "results.recheck.request": ["STU"],
    "results.recheck.edit": ["COO", "SUP"],
    "results.electives.set": ["COO", "SUP"],
    // Attendance: the Class Teacher marks students; the Co-ordinator marks teachers.
    "attendance.student.mark": ["TEA"],
    "attendance.teacher.mark": ["COO", "SUP"],
    // Personal details can be corrected only by the Co-ordinator, with a reason.
    "students.personal.correct": ["COO", "SUP"],
    "students.status.set": ["COO", "SUP"],
    "students.rollover": ["COO", "SUP"],
    // The Co-ordinator sets up years, classes and terminals; the Admin may look, never change them.
    "setup.structure.manage": ["COO", "SUP"],
    // Programmes and their levels: only the Admin (and Support), never a Co-ordinator (D-087).
    "setup.programmes.manage": ["ADM", "SUP"],
    // The Principal's dashboard: the Admin and Support only; never a Co-ordinator, Accountant, Teacher or Student (D-088).
    "dashboard.overview.view": ["ADM", "SUP"],
    "setup.structure.view": ["COO", "ADM", "SUP"],
    // Subjects, offerings, mark components and elective groups: the same people.
    "setup.subjects.manage": ["COO", "SUP"],
    "setup.subjects.view": ["COO", "ADM", "SUP"],
    // Staff: who sees the list, and who may give someone a new temporary password (the same people who may deactivate them).
    "accounts.staff.view": ["COO", "ADM", "SUP"],
    "accounts.password.issue": ["COO", "ADM", "SUP"],
  };

  it.each(Object.entries(exactly))("%s is allowed for exactly %j", (action, expected) => {
    expect(isKnownAction(action), `${action} exists`).toBe(true);
    expect(allowedBy(action).sort()).toEqual([...expected].sort());
  });

  it("the Co-ordinator has no fees access at all", () => {
    const feeActions = ALL_ACTIONS.filter((a) => a.startsWith("fees.") || a === "reports.fees");
    expect(feeActions.length).toBeGreaterThan(10);
    for (const action of feeActions) expect(allowedBy(action), action).not.toContain("COO");
  });

  it("a Teacher touches no money, no approvals and no account administration", () => {
    for (const action of ALL_ACTIONS.filter((a) => /^(fees|approvals|accounts|branding|audit)\./.test(a))) {
      expect(allowedBy(action), action).not.toContain("TEA");
    }
  });

  it("a Student can only do these things, each on their own record", () => {
    const studentMay = ALL_ACTIONS.filter((a) => allowedBy(a).includes("STU") && authorize([claim("STU")], a)?.anonymous !== true);
    expect(studentMay.sort()).toEqual(
      [
        "auth.sign_in",
        "students.personal.view",
        "attendance.student.view",
        "activity.read",
        "notes.view",
        "assignments.submit",
        "fees.view",
        "fees.voucher.upload",
        // Source 6.4, "Payments: online (parked)": the student pays their own fees online (demo adapter only, D-076).
        "fees.online.pay",
        "fees.receipts.view",
        "results.view",
        "results.top20.view",
        "results.recheck.request",
      ].sort(),
    );
    for (const action of studentMay.filter((a) => a !== "auth.sign_in")) {
      const grant = authorize([claim("STU")], action)!;
      expect(grant.own, action).toBe(true);
      expect(grant.institution, action).toBe(false);
    }
  });

  it("a Student sees Top 20 as name and rank only", () => {
    expect(authorize([claim("STU")], "results.top20.view")!.limits).toEqual(["name and rank only, own section, published"]);
  });

  it("a Teacher sees a student's SID and name only", () => {
    expect(authorize([claim("TEA")], "students.search")!.limits).toEqual(["sid+name"]);
  });

  it("the Accountant sees personal details but cannot change them", () => {
    expect(authorize([claim("ACC")], "students.personal.view")).not.toBeNull();
    expect(allowedBy("students.personal.correct")).not.toContain("ACC");
  });

  it("an Admin may look at fees but not act on them, and only an Accountant may", () => {
    expect(authorize([claim("ADM")], "fees.view")!.readOnly).toBe(true);
    expect(authorize([claim("ACC")], "fees.view")!.readOnly).toBe(false);
  });

  it("a Co-ordinator may deactivate Teachers only; an Admin only Co-ordinators and Accountants", () => {
    expect(authorize([claim("COO")], "accounts.deactivate")!.limits).toEqual(["teachers"]);
    expect(authorize([claim("ADM")], "accounts.deactivate")!.limits).toEqual(["co-ordinators, accountants"]);
    expect(authorize([claim("SUP")], "accounts.deactivate")!.limits).toEqual([]);
  });

  it("the Admin can look at the academic structure but not change it", () => {
    expect(authorize([claim("ADM")], "setup.structure.view")!.readOnly).toBe(true);
    expect(authorize([claim("ADM")], "setup.structure.manage")).toBeNull();
    expect(authorize([claim("COO")], "setup.structure.view")!.readOnly).toBe(false);
  });

  it("programmes and levels are the Admin's alone: no Co-ordinator, of any scope, makes or changes one (D-087)", () => {
    expect(authorize([claim("ADM")], "setup.programmes.manage")!.readOnly).toBe(false);
    expect(authorize([claim("COO")], "setup.programmes.manage")).toBeNull();
    expect(authorize([{ role: "coordinator", scope: "section", section: "plus2" }], "setup.programmes.manage")).toBeNull();
  });

  it("the Admin can look at subjects and elective groups but not change them; grading policy is not a setup permission", () => {
    expect(authorize([claim("ADM")], "setup.subjects.view")!.readOnly).toBe(true);
    expect(authorize([claim("ADM")], "setup.subjects.manage")).toBeNull();
    expect(authorize([claim("COO")], "setup.subjects.view")!.readOnly).toBe(false);
    expect(rowFor("setup.subjects.manage")!.label).not.toMatch(/grading/i);
  });

  it("who sees staff, and who may issue a temporary password, is limited the same way as who may deactivate", () => {
    expect(authorize([claim("COO")], "accounts.staff.view")!.limits).toEqual(["teachers"]);
    expect(authorize([claim("ADM")], "accounts.staff.view")!.readOnly).toBe(true);
    expect(authorize([claim("SUP")], "accounts.staff.view")!.limits).toEqual([]);
    for (const action of ["accounts.deactivate", "accounts.password.issue"]) {
      expect(authorize([claim("COO")], action)!.limits, action).toEqual(["teachers"]);
      expect(authorize([claim("ADM")], action)!.limits, action).toEqual(["co-ordinators, accountants"]);
      expect(authorize([claim("SUP")], action)!.limits, action).toEqual([]);
    }
    // Only the whole-school reach may issue a password: a Student, Teacher and Accountant never.
    for (const code of ["STU", "TEA", "ACC"] as const) expect(authorize([claim(code)], "accounts.password.issue"), code).toBeNull();
  });

  it("only the Principal (Admin) and Support decide where a Co-ordinator's or Accountant's access reaches (D-099)", () => {
    expect(authorize([claim("ADM")], "accounts.staff.access")).not.toBeNull();
    expect(authorize([claim("ADM")], "accounts.staff.access")!.readOnly).toBe(false);
    expect(authorize([claim("SUP")], "accounts.staff.access")).not.toBeNull();
    for (const code of ["STU", "TEA", "COO", "ACC"] as const) expect(authorize([claim(code)], "accounts.staff.access"), code).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Part 3. Scope (D-004): one set of Co-ordinators and Accountants today, and the code must work
// unchanged when they are split by section later.
// ---------------------------------------------------------------------------------------------
describe("scope: whole institution today, per section when split (D-004)", () => {
  const institutionReach = MATRIX.filter((r) => !r.anonymous && (r.cells.COO?.reach === "inst" || r.cells.ACC?.reach === "inst"));

  it("there are institution-reach actions to test", () => {
    expect(institutionReach.length).toBeGreaterThan(15);
  });

  it.each(["coordinator", "accountant"] as const)("a whole-institution %s reaches every section", (role) => {
    const code: RoleCode = role === "coordinator" ? "COO" : "ACC";
    for (const row of institutionReach.filter((r) => r.cells[code]?.reach === "inst")) {
      const grant = authorize([{ role, scope: "institution" }], row.id)!;
      expect(grant.institution, row.id).toBe(true);
      expect(canAccessSection(grant, "plus2"), row.id).toBe(true);
      expect(canAccessSection(grant, "bachelors"), row.id).toBe(true);
      expect(allowedSections(grant), row.id).toBe("all");
    }
  });

  it.each(["coordinator", "accountant"] as const)("a %s limited to +2 gets nothing from the Bachelor's section", (role) => {
    const code: RoleCode = role === "coordinator" ? "COO" : "ACC";
    for (const row of institutionReach.filter((r) => r.cells[code]?.reach === "inst")) {
      const grant = authorize([{ role, scope: "section", section: "plus2" }], row.id)!;
      expect(grant.institution, row.id).toBe(false);
      expect(canAccessSection(grant, "plus2"), row.id).toBe(true);
      expect(canAccessSection(grant, "bachelors"), row.id).toBe(false);
      expect(allowedSections(grant), row.id).toEqual(["plus2"]);
    }
  });

  it("two section assignments add up, and a whole-institution assignment beats them", () => {
    const both = authorize(
      [
        { role: "coordinator", scope: "section", section: "plus2" },
        { role: "coordinator", scope: "section", section: "bachelors" },
      ],
      "admissions.review",
    )!;
    expect(both.institution).toBe(false);
    expect(allowedSections(both)).toEqual(["plus2", "bachelors"]);

    const wide = authorize(
      [
        { role: "coordinator", scope: "section", section: "plus2" },
        { role: "coordinator", scope: "institution" },
      ],
      "admissions.review",
    )!;
    expect(wide.institution).toBe(true);
    expect(wide.sections).toEqual([]);
  });

  it("an Admin is always whole-institution, whatever a token claims", () => {
    // The database refuses an Admin limited to a section, but even a forged claim must not narrow or widen it.
    expect(authorize([{ role: "admin", scope: "institution" }], "audit.view")!.institution).toBe(true);
  });

  it("a section claim without a section name grants nothing", () => {
    expect(authorize([{ role: "coordinator", scope: "section" }], "admissions.review")).toBeNull();
  });

  it("a Co-ordinator with an 'own' scope claim (not a real assignment) gets nothing", () => {
    expect(authorize([{ role: "coordinator", scope: "own" }], "admissions.review")).toBeNull();
  });
});

describe("combining roles and failing closed", () => {
  it("a Teacher who is also a Co-ordinator gets both grants", () => {
    const grant = authorize(
      [
        { role: "teacher", scope: "assigned" },
        { role: "coordinator", scope: "institution" },
      ],
      "students.search",
    )!;
    expect(grant.assigned).toBe(true);
    expect(grant.institution).toBe(true);
  });

  it("read-only only if every granting role is read-only", () => {
    const mixed = authorize([{ role: "admin", scope: "institution" }, { role: "accountant", scope: "institution" }], "fees.view")!;
    expect(mixed.readOnly).toBe(false);
  });

  it.each([
    ["no roles at all", [] as RoleClaim[], "fees.view"],
    ["an unknown role", [{ role: "principal", scope: "institution" }] as RoleClaim[], "fees.view"],
    ["an unknown action", [{ role: "admin", scope: "institution" }] as RoleClaim[], "fees.delete_everything"],
    ["an empty action", [{ role: "admin", scope: "institution" }] as RoleClaim[], ""],
  ])("denies %s", (_label, roles, action) => {
    expect(authorize(roles, action)).toBeNull();
  });

  it("an anonymous action is open to everyone, including someone with no roles", () => {
    expect(authorize([], "site.view")?.anonymous).toBe(true);
    expect(authorize([], "admissions.apply")?.anonymous).toBe(true);
  });
});
