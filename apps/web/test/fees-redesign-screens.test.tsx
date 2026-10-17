import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { AccountView } from "@/fees/AccountView";
import { DiscountsTable } from "@/fees/DiscountsReportScreen";
import { LiveStructures, OtherStructures } from "@/fees/StructuresBoard";
import { DuesTable } from "@/fees/DuesScreen";
import { FeesTabs } from "@/fees/FeesTabs";
import type { Account, DiscountReport } from "@/fees/model";
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
const as = (role: string) => fakeSession({ status: "signedIn", me: { id: "user-1", name: "Asha", roles: [{ role, scope: "institution" }] } });
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
  chargedPaisa: 100_000,
  discountPaisa: 0,
  paidPaisa: 40_000,
  refundedPaisa: 0,
  balancePaisa: 60_000,
  duePaisa: 60_000,
  overduePaisa: 0,
  creditPaisa: 0,
  nextDue: null,
  entries: [],
  receipts: [],
  closed: null,
};

describe("a closed fee account (D-172, slice 5)", () => {
  it("says it is closed, when, and what stays owed; an open account says nothing of the kind", () => {
    const open = inContext(<AccountView account={account} />);
    expect(open).not.toContain("was closed on");
    const closed = inContext(<AccountView account={{ ...account, closed: { closedOnBs: "2083-07-01", owedPaisa: 60_000 } }} />);
    expect(closed).toContain("was closed on");
    expect(closed).toContain("stays owed");
    expect(inContext(<AccountView account={{ ...account, closed: { closedOnBs: "2083-07-01", owedPaisa: -5_000 } }} />)).toContain("in credit");
    expect(inContext(<AccountView account={{ ...account, closed: { closedOnBs: "2083-07-01", owedPaisa: 0 } }} />)).toContain("Nothing was owed");
  });

  it("the dues list marks a closed account in words and keeps what it owes", () => {
    const row = { enrollmentId: "e1", studentId: "s1", studentName: "Sita Sharma", sid: "2083-00001", classId: "c1", className: "Science · Grade 11", hasEmail: false, closed: true, chargedPaisa: 100_000, discountPaisa: 0, paidPaisa: 40_000, balancePaisa: 60_000, duePaisa: 60_000, overduePaisa: 0 };
    const html = inContext(<DuesTable students={[row, { ...row, enrollmentId: "e2", studentId: "s2", closed: false }]} />);
    expect(html).toContain("Closed, left");
    expect(html.match(/Closed, left/g)).toHaveLength(1);
  });
});

describe("the Principal's Discounts report", () => {
  const discounts: DiscountReport["discounts"] = [
    { id: "d1", studentName: "Sita Sharma", sid: "2083-00001", className: "Science · Grade 11", amountPaisa: 50_000, percent: null, reason: "scholarship", note: null, status: "active", givenOnBs: "2083-07-01", givenBy: "Ram Principal" },
    { id: "d2", studentName: "Hari Rai", sid: "2083-00002", className: "Science · Grade 11", amountPaisa: 10_000, percent: 10, reason: "other", note: "Flood relief", status: "removed", givenOnBs: "2083-07-02", givenBy: "Ram Principal" },
  ];

  it("lists who, how much, why, when, by whom, and each one's state in words", () => {
    const html = inContext(<DiscountsTable discounts={discounts} />, as("admin"));
    for (const word of ["Sita Sharma", "Hari Rai", "Scholarship", "Flood relief", "Ram Principal", "Active", "Taken back"]) expect(html).toContain(word);
  });

  it("an empty report says so", () => {
    expect(inContext(<DiscountsTable discounts={[]} />, as("admin"))).toContain("No discount has been given yet");
  });

  it("only the Principal has the Discounts tab", () => {
    expect(inContext(<FeesTabs pathname="/portal/fees" />, as("admin"))).toContain("Discounts");
    expect(inContext(<FeesTabs pathname="/portal/fees" />, as("accountant"))).not.toContain("/portal/fees/discounts");
  });
});

describe("a structure that has ended (the PM, 2026-10-17)", () => {
  const base = { sectionKey: "plus2", startDate: "2026-04-14", endDate: "2027-04-13", startDateBs: "2083-01-01", endDateBs: "2083-12-30", status: "live" as const, totalPaisa: 100_000, levelsLinked: 2, editing: false };
  const running = { ...base, id: "a", name: "Running fees", ended: false };
  const over = { ...base, id: "b", name: "Last year fees", ended: true };

  it("is not among the live cards; it is in the other list, marked Ended", () => {
    const live = inContext(<LiveStructures structures={[running, over]} sections={[{ key: "plus2", name: "+2" }]} />);
    expect(live).toContain("Running fees");
    expect(live).not.toContain("Last year fees");
    expect(live).toContain("Currently Live (1)");
    const other = inContext(<OtherStructures structures={[running, over]} sections={[{ key: "plus2", name: "+2" }]} />);
    expect(other).toContain("Last year fees");
    expect(other).not.toContain("Running fees");
    expect(other).toContain("Ended");
  });
});
