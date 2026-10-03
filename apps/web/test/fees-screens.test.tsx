import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { AccountView, accountFigures, History } from "@/fees/AccountView";
import { FeesTabs } from "@/fees/FeesTabs";
import { FeesHome } from "@/fees/FeesHome";
import { DuesScreen, DuesTable, duesFigures, dueState } from "@/fees/DuesScreen";
import { FoundStudents } from "@/fees/FeesHome";
import { ReceiptPaper } from "@/fees/ReceiptScreen";
import { ItemsTable } from "@/fees/StructureScreen";
import { StructuresTable } from "@/fees/StructuresScreen";
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
  it("leads with charged, discount, paid and the balance, then what is due, overdue and next, in NPR with Nepali grouping (D-104)", () => {
    expect(accountFigures(account).map((f) => [f.label, f.value])).toEqual([
      ["Charged", "NPR 12,50,000"],
      ["Discounts", "NPR 0"],
      ["Paid", "NPR 2,50,000"],
      ["Balance", "NPR 10,00,000"],
    ]);
    expect(accountFigures({ ...account, chargedPaisa: 0, paidPaisa: 0, balancePaisa: 0, duePaisa: 0 })[3]!.value).toBe("Nothing charged yet");
    expect(accountFigures({ ...account, balancePaisa: -2_000_000, creditPaisa: 2_000_000, duePaisa: 0 })[3]!.value).toBe("Credit NPR 20,000");
    const html = inContext(<AccountView account={account} />);
    expect(html).toContain("Due now NPR 10,00,000 · of which overdue NPR 4,00,000 · next due NPR 10,00,000 on 1 Baisakh 2083");
  });

  it("the history is newest first; a payment opens its receipt and a reversed one says so", () => {
    const html = inContext(<History entries={account.entries} />);
    expect(html.indexOf("Payment")).toBeLessThan(html.indexOf("Charge"));
    expect(html).toContain("View receipt");
    expect(html).toContain(">Reversed<");
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

describe("the dues list's words (admin FUT F-10)", () => {
  it("a student with nothing charged is not shown as paid up", () => {
    expect(dueState({ chargedPaisa: 0, paidPaisa: 0, duePaisa: 0 })).toBe("nothing");
    expect(dueState({ chargedPaisa: 300_000, paidPaisa: 300_000, duePaisa: 0 })).toBe("clear");
    expect(dueState({ chargedPaisa: 300_000, paidPaisa: 0, duePaisa: 300_000 })).toBe("due");
  });
});

describe("the Principal reads fees (D-104, after the PM's topic 7 reference)", () => {
  const receipt = { id: "r1", number: "P2-2083-00007", amountPaisa: 2_000_000, method: "cash" as const, issuedAt: "2026-10-03T05:00:00.000Z", issuedOnBs: "2083-06-17", studentName: "Sita Sharma", sid: "2083-00001", className: "Science · Grade 11", yearLabel: "2083", reversed: false, balanceAfterPaisa: 2_005_050 };

  it("a receipt is a paper: number, BS day, the amount, who paid how, the balance now, and Print", () => {
    const html = inContext(<ReceiptPaper receipt={receipt} schoolName="Royal Softech College" />, as("admin"));
    for (const text of ["Royal Softech College", "P2-2083-00007", "17 Ashwin 2083", "NPR 20,000", "Cash", "NPR 20,050.50", "Generated from the fee ledger.", "Print"]) expect(html).toContain(text);
    expect(html).not.toContain("Reversed");
    const reversed = inContext(<ReceiptPaper receipt={{ ...receipt, reversed: true }} schoolName="Royal Softech College" />, as("admin"));
    expect(reversed).toContain(">Reversed<");
    expect(reversed).toContain("This payment was reversed.");
  });

  const row = (n: number, charged: number, paid: number, due: number, overdue: number) => ({
    enrollmentId: `e${n}`,
    studentId: `s${n}`,
    studentName: `Student ${n}`,
    sid: `2083-0000${n}`,
    classId: "c1",
    className: "Science · Grade 11",
    hasEmail: false,
    chargedPaisa: charged,
    discountPaisa: 0,
    paidPaisa: paid,
    balancePaisa: charged - paid,
    duePaisa: due,
    overduePaisa: overdue,
  });
  const students = [row(1, 0, 0, 0, 0), row(2, 300_000, 300_000, 0, 0), row(3, 300_000, 0, 300_000, 100_000), row(4, 300_000, 100_000, 200_000, 0)];

  it("dues: figures, and each row in words, opening the student's fee account; nothing charged is not paid up", () => {
    expect(duesFigures(students).map((f) => [f.label, f.value])).toEqual([
      ["Due", "NPR 5,000"],
      ["Overdue", "NPR 1,000"],
      ["Students with dues", "2"],
    ]);
    const html = inContext(<DuesTable students={students} />, as("admin"));
    expect(html).toContain(">Nothing charged yet<");
    expect(html).toContain(">Paid up<");
    expect(html).toContain(">Overdue<");
    expect(html).toContain(">Due<");
    expect(html).toContain('href="/portal/fees/student?id=s3"');
  });

  it("the finder shows each student's balance this year in words, and opens the account", () => {
    const found = [{ id: "s3", sid: "2083-00003", firstName: "Student", lastName: "3", status: "active" as const, className: "Science · Grade 11" }];
    const html = inContext(<FoundStudents students={found} balances={new Map(students.map((x) => [x.sid, x]))} />, as("admin"));
    expect(html).toContain(">Overdue NPR 3,000<");
    expect(html).toContain('href="/portal/fees/student?id=s3"');
    expect(inContext(<FoundStudents students={found} balances={null} />, as("admin"))).not.toContain("Balance this year");
  });

  it("a structure's items read as the Approvals panel: item, billed, amount, and the yearly total; no Remove for the Principal", () => {
    const structure = { id: "f1", levelId: "l1", status: "live" as const, yearLabel: "2083", programmeName: "Science", levelName: "Grade 11", sectionKey: "plus2", yearlyTotalPaisa: 6_200_000, items: [{ id: "i1", name: "Tuition", amountPaisa: 350_000, frequency: "monthly" as const }], classes: [] };
    const html = inContext(<ItemsTable structure={structure} />, as("admin"));
    for (const text of ["Tuition", "Monthly", "NPR 3,500", "Yearly total", "NPR 62,000"]) expect(html).toContain(text);
    expect(html).not.toMatch(/<button/);
    expect(inContext(<StructuresTable structures={[structure]} />, as("admin"))).toContain(">Live<");
  });
});
