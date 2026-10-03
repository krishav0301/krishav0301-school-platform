import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AuditTrailList, SignInList, signInReason } from "@/audit/AuditScreen";
import type { AuditTrail, SignInLog } from "@/audit/client";
import { REPORT_GROUPS } from "@/reports/ReportsScreen";

/** The Audit trail and Sign-ins views (CLAUDE.md section 6, D-102, admin FUT F-11). */
describe("the audit trail", () => {
  const data: AuditTrail = {
    rows: [
      { id: 2, onBs: "2083-06-16", time: "14:05", at: "2026-10-02T08:20:00Z", action: "fees.discount.applied", entityType: "discount", summary: "Discount of NPR 4,450.00 applied", reason: "Sibling", actor: "Rajendra Prasad Shah" },
      { id: 1, onBs: "2083-06-16", time: "09:00", at: "2026-10-02T03:15:00Z", action: "academics.section.created", entityType: "section", summary: 'Section "Bachelor\'s" added', reason: null, actor: "Support" },
    ],
    total: 2,
    page: 1,
    pageSize: 25,
  };

  it("says what happened, who did it, and when in the Nepali calendar", () => {
    const html = renderToStaticMarkup(<AuditTrailList data={data} />);
    expect(html).toContain("Discount of NPR 4,450.00 applied");
    expect(html).toContain("Rajendra Prasad Shah · 16 Ashwin 2083, 14:05");
    expect(html).toContain("Reason: Sibling");
    expect(html).toContain("Support · 16 Ashwin 2083, 09:00");
  });

  it("says when nothing matches", () => {
    expect(renderToStaticMarkup(<AuditTrailList data={{ ...data, rows: [], total: 0 }} />)).toContain("Nothing matches.");
  });

  it("is reached from Reports, so the menu stays as it is", () => {
    const hrefs = REPORT_GROUPS.flatMap((g) => g.entries.map((e) => e.href));
    expect(hrefs).toEqual(expect.arrayContaining(["/portal/reports/activity", "/portal/reports/sign-ins"]));
  });
});

describe("sign-ins", () => {
  const data: SignInLog = {
    rows: [
      { id: 3, onBs: "2083-06-16", time: "10:01", at: "2026-10-02T04:16:00Z", name: "Gita Thapa", email: "gita@school.example", success: false, reason: "bad_password", ip: "203.0.113.9" },
      { id: 2, onBs: "2083-06-16", time: "10:02", at: "2026-10-02T04:17:00Z", name: "Gita Thapa", email: "gita@school.example", success: true, reason: null, ip: null },
      { id: 1, onBs: "2083-06-16", time: "10:03", at: "2026-10-02T04:18:00Z", name: null, email: "nobody@school.example", success: false, reason: "unknown_user", ip: null },
    ],
    total: 3,
    page: 1,
    pageSize: 25,
  };

  it("says success or failure in words, with the reason in plain language, never the stored code", () => {
    const html = renderToStaticMarkup(<SignInList data={data} />);
    expect(html).toContain(">Failed<");
    expect(html).toContain(">Signed in<");
    expect(html).toContain("Wrong password");
    expect(html).toContain("No account with this email");
    expect(html).toContain("From 203.0.113.9");
    expect(html).not.toContain("bad_password");
  });

  it("turns every stored reason into words", () => {
    expect(signInReason("password_ok_two_factor_challenge")).toBe("Password right; authenticator code next");
    expect(signInReason("two_factor_failed")).toBe("Wrong authenticator code");
    expect(signInReason("something_new")).toBe("Other");
    expect(signInReason(null)).toBeNull();
  });
});
