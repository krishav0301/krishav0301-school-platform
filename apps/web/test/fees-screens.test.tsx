import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { AccountView } from "@/fees/AccountView";
import { FeesTabs } from "@/fees/FeesTabs";
import { FeesHome } from "@/fees/FeesHome";
import { DuesScreen } from "@/fees/DuesScreen";
import type { Account } from "@/fees/model";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/fees", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: { fees: true },
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
};
const as = (role: string, scope: "institution" | "own" = "institution") => fakeSession({ status: "signedIn", me: { name: "Asha", roles: [{ role, scope }] } });
const inContext = (element: React.ReactNode, session = as("accountant")) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={session}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

const account: Account = {
  enrollmentId: "e1",
  studentName: "Sita Sharma",
  sid: "2083-00001",
  className: "Science · Grade 11",
  yearLabel: "2083",
  chargedPaisa: 125_000_000,
  discountPaisa: 0,
  paidPaisa: 25_000_000,
  refundedPaisa: 0,
  balancePaisa: 100_000_000,
  duePaisa: 100_000_000,
  overduePaisa: 40_000_000,
  creditPaisa: 0,
  nextDue: { dueOn: "2026-04-14", dueOnBs: "2083-01-01", remainingPaisa: 100_000_000 },
  entries: [
    { id: "c1", kind: "charge", amountPaisa: 125_000_000, memo: "Annual fee", period: "year", dueOnBs: "2083-01-01", createdOnBs: "2083-06-12", reversed: false, receiptId: null },
    { id: "p1", kind: "payment", amountPaisa: -25_000_000, memo: "Cash at the counter", period: null, dueOnBs: null, createdOnBs: "2083-06-12", reversed: true, receiptId: "r1" },
  ],
  receipts: [{ id: "r1", number: "plus2-2083-00001", amountPaisa: 25_000_000, issuedOnBs: "2083-06-12", reversed: true }],
};

describe("the account", () => {
  it("leads with what is due, overdue and next, in NPR with Nepali grouping", () => {
    const html = inContext(<AccountView account={account} />);
    expect(html).toContain("Due now");
    expect(html).toContain("NPR 10,00,000.00");
    expect(html).toContain("NPR 4,00,000.00");
    expect(html).toContain("NPR 10,00,000.00 on 2083-01-01");
  });

  it("lists receipts with a link each, and marks a reversed payment in words", () => {
    const html = inContext(<AccountView account={account} />);
    expect(html).toContain('href="/portal/fees/receipt?id=r1"');
    expect(html).toContain("Receipt plus2-2083-00001");
    expect(html).toContain("Reversed");
    expect(html).not.toContain("-2,50,000");
  });
});

describe("fees places", () => {
  it("the Accountant gets Students, Fee structures, Vouchers and Dues; the Admin no Vouchers; a student no tabs", () => {
    const accountant = inContext(<FeesTabs pathname="/portal/fees" />);
    for (const href of ["/portal/fees/structures", "/portal/fees/vouchers", "/portal/fees/dues"]) expect(accountant).toContain(href);
    expect(inContext(<FeesTabs pathname="/portal/fees" />, as("admin"))).not.toContain("/portal/fees/vouchers");
    expect(inContext(<FeesTabs pathname="/portal/fees" />, as("student", "own"))).toBe("");
  });

  it("a student lands on their own fees; staff on the student finder", () => {
    expect(inContext(<FeesHome />, as("student", "own"))).toContain("Your fees");
    expect(inContext(<FeesHome />)).toContain("Find a student");
  });

  it("the dues list shows the shape of the page while it loads", () => {
    expect(inContext(<DuesScreen />)).toMatch(/role="status"[^>]*aria-busy="true"/);
  });
});
