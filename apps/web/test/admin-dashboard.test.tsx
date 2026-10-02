import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { AdminDashboardView } from "@/dashboard/AdminDashboard";
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
  results: { publications: 0, lastPublishedAt: null, byProgramme: [] },
  attention: { approvals: { count: 4, kinds: [{ kind: "discount", count: 4 }] }, feeFollowUps: 12, anomalies: { count: 0, classes: [] }, websiteDrafts: 0 },
  website: { origin: "https://royalsoftech.example", live: 3, drafts: 1, waiting: 0, lastPublishedAt: "2026-09-12T10:47:00.000Z" },
  activity: [
    { id: "1", at: "2026-09-30T06:00:00.000Z", action: "content.published", summary: "Notice published", actorName: null, actorIsSupport: true, entityType: "content_item", entityId: "c1" },
    { id: "2", at: "2026-09-30T04:00:00.000Z", action: "admissions.approved", summary: "Rahul Sharma admitted", actorName: "Sita Sharma", actorIsSupport: false, entityType: "student", entityId: "s1" },
  ],
};

const render = (o: Overview) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <AdminDashboardView o={o} name="Principal" now={new Date("2026-09-30T08:00:00.000Z")} />
    </ConfigContext.Provider>,
  );

describe("the Principal's dashboard (D-088)", () => {
  const html = render(base);

  it("greets by the time of day in Nepal, with today in Bikram Sambat and the worked-out status", () => {
    expect(html).toContain("Good afternoon, Principal");
    expect(html).toContain("14 Ashwin 2083");
    expect(html).toContain("A few things need your attention.");
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

  it("attention lists only what is waiting, each a link to where it is handled", () => {
    expect(html).toContain("pending approvals");
    expect(html).toContain('href="/portal/approvals"');
    expect(html).toContain("fee follow-ups");
    expect(html).not.toContain("attendance anomalies");
    expect(html).not.toContain("website drafts");
  });

  it("an empty attention list reassures instead of showing nothing", () => {
    const calm = render({ ...base, status: "on_track", attention: { approvals: { count: 0, kinds: [] }, feeFollowUps: 0, anomalies: { count: 0, classes: [] }, websiteDrafts: 0 } });
    expect(calm).toContain("You&#x27;re all caught up.");
    expect(calm).toContain("Everything important is on track.");
  });

  it("quick actions lead to the real flows", () => {
    for (const href of ["/portal/people?add=coordinator", "/portal/people?add=accountant", "/portal/content?new=post", "/portal/setup/programmes?add=1"]) {
      expect(html).toContain(`href="${href.replace(/&/g, "&amp;")}"`);
    }
  });

  it("recent activity in plain words, the build team shown as Support and never by name", () => {
    expect(html).toContain("Website post published");
    expect(html).toContain("New student admitted");
    expect(html).toContain("2 hours ago · Support");
    expect(html).toContain("4 hours ago · Sita Sharma");
  });

  it("carries no colour of its own", () => {
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/style="[^"]*(?:color|background)\s*:/);
  });
});
