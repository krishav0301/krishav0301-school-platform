import { describe, expect, it } from "vitest";

import { addableRoles, canManageMember, canManagePeople, validateStaffForm, type StaffMember } from "@/people/model";

const role = (r: string, scope: string, section?: string) => ({ role: r, scope, ...(section ? { section } : {}) });
const member = (roles: string[], homeSection: string | null = null): StaffMember => ({
  id: "m1",
  fullName: "Sita Sharma",
  email: "sita@school.example",
  phone: null,
  roles: roles.map((r) => ({ role: r, scope: r === "teacher" ? "assigned" : "institution", section: null })),
  homeSection,
  active: true,
  mustChangePassword: false,
  lastSignInAt: null,
});

describe("who may add whom (tidiness only; the API decides)", () => {
  it("the Admin adds Co-ordinators and Accountants, a Co-ordinator adds teachers, the Super Admin all three, nobody else anyone", () => {
    expect(addableRoles([role("admin", "institution")])).toEqual(["coordinator", "accountant"]);
    expect(addableRoles([role("coordinator", "institution")])).toEqual(["teacher"]);
    expect(addableRoles([role("coordinator", "section", "plus2")])).toEqual(["teacher"]);
    expect(addableRoles([role("super_admin", "institution")])).toEqual(["coordinator", "accountant", "teacher"]);
    for (const other of ["accountant", "teacher", "student"]) expect(addableRoles([role(other, "institution")]), other).toEqual([]);
    expect(addableRoles([])).toEqual([]);
  });

  it("the People screen is for whoever may add someone", () => {
    expect(canManagePeople([role("admin", "institution")])).toBe(true);
    expect(canManagePeople([role("teacher", "assigned")])).toBe(false);
  });
});

describe("who may switch off or re-password a person shown", () => {
  it("the Admin manages Co-ordinators and Accountants, not teachers", () => {
    const admin = [role("admin", "institution")];
    expect(canManageMember(admin, member(["coordinator"]))).toBe(true);
    expect(canManageMember(admin, member(["accountant"]))).toBe(true);
    expect(canManageMember(admin, member(["teacher"], "plus2"))).toBe(false);
  });

  it("a Co-ordinator manages teachers only, and a section-scoped one only their own section's", () => {
    const whole = [role("coordinator", "institution")];
    const plus2 = [role("coordinator", "section", "plus2")];
    expect(canManageMember(whole, member(["teacher"], "bachelors"))).toBe(true);
    expect(canManageMember(whole, member(["coordinator"]))).toBe(false);
    expect(canManageMember(plus2, member(["teacher"], "plus2"))).toBe(true);
    expect(canManageMember(plus2, member(["teacher"], "bachelors"))).toBe(false);
  });

  it("the Super Admin manages anyone shown; other roles no one", () => {
    expect(canManageMember([role("super_admin", "institution")], member(["admin"]))).toBe(true);
    expect(canManageMember([role("accountant", "institution")], member(["teacher"], "plus2"))).toBe(false);
  });
});

describe("validateStaffForm", () => {
  const good = { fullName: "Sita Sharma", email: "sita@school.example", phone: "", role: "coordinator" as const, sectionKey: "" };

  it("accepts a good form, with the phone optional and the section optional for a Co-ordinator", () => {
    expect(validateStaffForm(good)).toEqual({});
    expect(validateStaffForm({ ...good, phone: "9841234567" })).toEqual({});
  });

  it("wants a name of at least two letters, an email, and a phone that is long enough when given", () => {
    expect(validateStaffForm({ ...good, fullName: " S " })).toEqual({ fullName: "people.error.nameRequired" });
    expect(validateStaffForm({ ...good, email: "not-an-email" })).toEqual({ email: "people.error.emailInvalid" });
    expect(validateStaffForm({ ...good, email: "" })).toEqual({ email: "people.error.emailInvalid" });
    expect(validateStaffForm({ ...good, phone: "12" })).toEqual({ phone: "people.error.phoneInvalid" });
  });

  it("a teacher must have a home section", () => {
    expect(validateStaffForm({ ...good, role: "teacher", sectionKey: "" })).toEqual({ sectionKey: "people.error.homeSectionRequired" });
    expect(validateStaffForm({ ...good, role: "teacher", sectionKey: "plus2" })).toEqual({});
  });
});
