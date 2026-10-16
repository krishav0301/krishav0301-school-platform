import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { AdminDashboardView, ResultsTab } from "@/dashboard/AdminDashboard";
import type { Overview } from "@/dashboard/admin-model";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: {},
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
};

const base: Overview = {
  asOf: "2026-09-30T08:00:00.000Z",
  todayBs: "2083-06-14",
  schoolDay: true,
  status: "attention",
  students: { total: 1248, changePercent: 5 },
  staff: { total: 86, changePercent: null },
  attendance: {
    percent: 92,
    present: 1148,
    marked: 1248,
    enrolled: 1248,
    previousPercent: 90,
    trend: [
      { date: "2026-09-29", dateBs: "2083-06-13", percent: 90 },
      { date: "2026-09-30", dateBs: "2083-06-14", percent: 92 },
    ],
    byProgramme: [{ id: "p1", name: "+2 Science", percent: 94, present: 94, marked: 100, enrolled: 100 }],
  },
  fees: { collectedPaisa: 284_000_000, changePercent: 12, chargedPaisa: 1_000_000, paidPaisa: 500_000, duePaisa: 500_000, overduePaisa: 100_000 },
  programmes: [{ id: "p1", name: "+2 Science", sectionName: "+2", active: true, levels: 2, classes: 2, students: 100, teachers: 9 }],
  results: { publications: 0, lastPublishedAt: null, sheets: { expected: 0, sent: 0, underReview: 0 }, byProgramme: [] },
  attention: { approvals: { count: 4, kinds: [{ kind: "discount", count: 4 }] }, feeFollowUps: 12, anomalies: { count: 0, classes: [] }, websiteDrafts: 0 },
  website: { origin: "https://royalsoftech.example", live: 3, drafts: 1, waiting: 0, lastPublishedAt: "2026-09-12T10:47:00.000Z" },
};

const render = (o: Overview) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <AdminDashboardView o={o} name="Principal" now={new Date("2026-09-30T08:00:00.000Z")} />
    </ConfigContext.Provider>,
  );

describe("the Principal's dashboard (D-088)", () => {
  const html = render(base);

  it("greets by the time of day in Nepal, with today in Bikram Sambat and no status line (the PM, 2026-10-06)", () => {
    expect(html).toContain("Good afternoon, Principal");
    expect(html).toContain("14 Ashwin 2083");
    expect(html).not.toMatch(/need your attention\.|on track\./);
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("the four figures, formatted, with a change only where there is one to show", () => {
    expect(html).toContain("1,248");
    expect(html).toContain("+5%");
    expect(html).toContain("92%");
    expect(html).toContain("1,148 of 1,248 present");
    expect(html).toContain("NPR 28.4 L");
    expect(html).toContain("+12%");
    expect(html).toContain("Nothing to compare yet"); // staff had no figure a month ago
  });

  it("has no Attention needed or Website card (the PM, 2026-10-17)", () => {
    expect(html).not.toContain("Attention needed");
    expect(html).not.toContain("pending approvals");
    expect(html).not.toContain("all caught up");
    expect(html).not.toContain("Awaiting review");
    expect(html).not.toContain("Manage</a>");
  });

  it("quick actions lead to the real flows", () => {
    for (const href of ["/portal/people?add=coordinator", "/portal/people?add=accountant", "/portal/content?new=post", "/portal/setup/programmes?add=1"]) {
      expect(html).toContain(`href="${href.replace(/&/g, "&amp;")}"`);
    }
  });

  it("has no Recent activity (the PM, 2026-10-06)", () => {
    expect(html).not.toContain("Recent activity");
  });

  it("carries no colour of its own", () => {
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/style="[^"]*(?:color|background)\s*:/);
  });
});

describe("the Setup Overview quick action (the PM, 2026-10-11)", () => {
  it("is there beside the other quick actions, and opens the setup overview", () => {
    const html = render(base);
    expect(html).toContain("Setup Overview");
    expect(html).toContain("See how it all links");
    expect(html).toContain("href=\"/portal/setup/map\"");
  });
});

describe("with Fees switched off (D-137, the PM 2026-10-11)", () => {
  const off = renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <AdminDashboardView o={base} name="Principal" now={new Date("2026-09-30T08:00:00.000Z")} feesOn={false} />
    </ConfigContext.Provider>,
  );

  it("the Principal sees nothing about fees: no figure, no tab, no Accountant to add", () => {
    expect(off).not.toContain("NPR 28.4 L");
    expect(off).not.toContain("/portal/fees");
    expect(off).not.toContain("add=accountant");
    expect(off).not.toMatch(/follow-ups?|fees/i);
    // The rest of the dashboard is untouched.
    expect(off).toContain("1,248");
    expect(off).toContain("add=coordinator");
  });

  it("with fees on, the same dashboard still shows them", () => {
    expect(render(base)).toContain("/portal/fees/dues");
    expect(render(base)).toContain("add=accountant");
  });
});

describe("with Attendance switched off too (a results-only school, the PM 2026-10-11)", () => {
  const view = (feesOn: boolean, attendanceOn: boolean) =>
    renderToStaticMarkup(
      <ConfigContext.Provider value={makeConfigValue("ready", config)}>
        <AdminDashboardView o={{ ...base, attention: { ...base.attention, anomalies: { count: 3, classes: [] } } }} name="Principal" now={new Date("2026-09-30T08:00:00.000Z")} feesOn={feesOn} attendanceOn={attendanceOn} />
      </ConfigContext.Provider>,
    );

  it("no attendance figure or tab; the first tab is the next one; students, staff and results stay", () => {
    const html = view(false, false);
    expect(html).not.toContain("/portal/attendance");
    expect(html).not.toContain("92%");
    expect(html).not.toContain("1,148 of 1,248 present");
    expect(html).not.toMatch(/Attendance/);
    expect(html).toContain("1,248");
    expect(html).toContain("Results");
    expect(html).toMatch(/<button[^>]*aria-selected="true"[^>]*>[^<]*(Programme|Course|Department)/i); // it opens on the next tab, not on an empty Attendance
  });

  it("with attendance on, the figure and the tab are there", () => {
    const html = view(false, true);
    expect(html).toContain("92%");
    expect(html).toContain("/portal/attendance");
  });
});

describe("the results figures for a school that runs the result system (the PM, 2026-10-11)", () => {
  const withSheets = { ...base, results: { ...base.results, publications: 6, lastPublishedAt: "2026-09-29T10:00:00.000Z", sheets: { expected: 40, sent: 31, underReview: 5 } } };
  const view = (o: Overview, feesOn: boolean, attendanceOn: boolean) =>
    renderToStaticMarkup(
      <ConfigContext.Provider value={makeConfigValue("ready", config)}>
        <AdminDashboardView o={o} name="Principal" now={new Date("2026-09-30T08:00:00.000Z")} feesOn={feesOn} attendanceOn={attendanceOn} />
      </ConfigContext.Provider>,
    );

  it("with fees and attendance off: two figures, what is waiting to be verified (with its line) and what is published", () => {
    const html = view(withSheets, false, false);
    expect(html).toContain("Waiting to be verified");
    expect(html).toContain("Marks submitted by teachers, not yet verified by the Co-ordinator");
    expect(html).toContain("Results published");
    expect(html).toContain("class results, last on");
    expect(html).toContain(">5<");
    expect(html).toContain(">6<");
    expect(html).toContain('href="/portal/results/sheets"');
    // The third figure (marks still to be sent) is gone (the PM, 2026-10-12).
    expect(html).not.toContain("Marks still to be sent");
  });

  it("says so when nothing is published, and keeps the waiting line", () => {
    const html = view({ ...base, results: { ...base.results, sheets: { expected: 4, sent: 4, underReview: 0 } } }, false, false);
    expect(html).toContain("Nothing published yet");
    expect(html).toContain("Marks submitted by teachers, not yet verified by the Co-ordinator");
  });

  it("a school that keeps fees and attendance sees its dashboard as before, without these figures", () => {
    const html = view(withSheets, true, true);
    expect(html).not.toContain("Waiting to be verified");
    expect(html).not.toContain("Marks still to be sent");
  });
});

describe("the Results tab of Institution at a glance (the PM, 2026-10-17)", () => {
  const tab = (results: Overview["results"]) => renderToStaticMarkup(<ResultsTab o={{ ...base, results }} />);

  it("with only an exam published, no final yet: says so instead of showing empty column headings", () => {
    const html = tab({ ...base.results, publications: 1, byProgramme: [] });
    expect(html).toContain("1 exam result published");
    expect(html).toContain("appear here once a final result is published");
    expect(html).not.toContain("<table");
  });

  it("with a final published: the table of marks cards, pass rate and average", () => {
    const html = tab({ ...base.results, publications: 2, byProgramme: [{ id: "p1", name: "Science", cards: 30, passed: 27, passPercent: 90, avgPercentHundredths: 7250 }] });
    expect(html).toContain("2 exam results published");
    expect(html).toContain("<table");
    expect(html).toContain(">Science<");
    expect(html).toContain("90%");
    expect(html).toContain("72.5%");
  });
});
