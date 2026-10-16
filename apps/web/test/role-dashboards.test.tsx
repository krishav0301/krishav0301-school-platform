import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { AccountantDashboard, DayList, feesFigures, feesRows } from "@/dashboard/RoleDashboards";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: { attendance: true, teacher_attendance: true, homework: true, notes: true },
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
};
const as = (role: string, scope: "institution" | "own" | "assigned") => fakeSession({ status: "signedIn", me: { id: "user-1", name: "Asha", roles: [{ role, scope }] } });
const inContext = (element: React.ReactNode, session = as("teacher", "assigned")) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={session}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

describe("the Accountant's home (D-107)", () => {
  it("greets at once and shows the shape of its figures while it loads", () => {
    const html = inContext(<AccountantDashboard />, as("accountant", "institution"));
    expect(html).toMatch(/<h1[^>]*>Good (morning|afternoon|evening), Asha</);
    expect(html).toMatch(/role="status"[^>]*aria-busy="true"/);
    expect(html).toContain("What you can do as");
  });

  it("a row is a fact, its state in words and the page to act on it; with nothing to do, it says so", () => {
    const html = inContext(<DayList rows={[{ key: "a", title: "Register · Science", meta: "Today's register is not marked yet", todo: true, href: "/portal/attendance", action: "Mark register" }]} />);
    expect(html).toContain("Today&#x27;s register is not marked yet");
    expect(html).toContain('href="/portal/attendance"');
    expect(html).toContain('aria-label="Mark register: Register · Science"');
    expect(html).toMatch(/data-tone="warn"[^>]*>To do</);
    expect(inContext(<DayList rows={[]} />)).toContain("Nothing needs you right now.");
  });

  it("the Accountant's day: deposits to check, students overdue, what is due, structures waiting", () => {
    const day = { vouchers: 1, overdue: { students: 3, paisa: 450_000 }, duePaisa: 6_000_000, structures: { draft: 1, waiting: 0, live: 2 } };
    expect(feesFigures(day).map((f) => f.value)).toEqual(["1", "3", "NPR 60,000", "0"]);
    const rows = feesRows(day);
    expect(rows.map((r) => [r.key, r.todo])).toEqual([["vouchers", true], ["overdue", true], ["structures", true]]);
    expect(rows[1]!.meta).toBe("3 students owe NPR 4,500 past the due day");
    expect(rows[2]!.meta).toBe("2 live, 0 waiting for approval, 1 drafts");
  });
});
