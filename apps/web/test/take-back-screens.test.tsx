import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import type { ClassSheet, ReviewBoard } from "@/results/model";
import { BoardClassPanel } from "@/results/ReviewScreen";
import { TakeBackPanel } from "@/results/StaffScreens";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/results/sheets", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

/** Taking a published exam back to be corrected (D-199): the Principal's panel, and what the Co-ordinator's board then says. */

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: { results: true },
  terms: { "role.admin": "Principal", "role.coordinator": "Co-ordinator" },
  theme: royal.theme as PublicConfig["theme"],
};
const session = fakeSession({ status: "signedIn", me: { id: "user-1", name: "Principal", roles: [{ role: "admin", scope: "institution" }] } });
const inContext = (element: React.ReactNode) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={session}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  ).replaceAll("&#x27;", "'");
const noop = () => {};

const sheet: ClassSheet = {
  classId: "c1",
  programmeName: "+2 Science",
  levelName: "Grade 11",
  label: "A",
  terminal: { id: "t1", name: "First terminal" },
  graded: false,
  publishedAt: "2026-11-20T05:00:00Z",
  subjects: [
    { offeringId: "o1", name: "English" },
    { offeringId: "o2", name: "Maths" },
  ],
  students: [],
};

describe("the take-back panel", () => {
  it("names the class and exam, lists every subject to choose, and says what happens", () => {
    const html = inContext(<TakeBackPanel sheet={sheet} onClose={noop} onDone={noop} />);
    expect(html).toContain(">Take back results</h2>");
    expect(html).toContain("+2 Science · Grade 11 · A · First terminal");
    expect(html).toContain(">English<");
    expect(html).toContain(">Maths<");
    expect(html).toContain(t("results.takeBack.intro"));
    expect(html).toContain("final result is hidden too until then, because it is made from every exam.");
    expect(html).toContain(t("results.takeBack.reasonHint"));
  });

  it("its one button waits for a subject and a reason", () => {
    const html = inContext(<TakeBackPanel sheet={sheet} onClose={noop} onDone={noop} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Take back results</);
  });
});

describe("the Co-ordinator's board after a take-back", () => {
  const cls: ReviewBoard["classes"][number] = {
    classId: "c1",
    programmeName: "+2 Science",
    levelName: "Grade 11",
    label: "A",
    published: false,
    finalPublished: false,
    ready: false,
    takenBack: "Maths entered wrongly at the initial load",
    subjects: [{ offeringId: "o2", subjectName: "Maths", teacherName: "Anita Mandal", sheetId: "s2", status: "draft", missing: 0 }],
  };

  it("says the Principal took it back and why, and offers Publish again once ready", () => {
    const html = inContext(<BoardClassPanel cls={cls} terminalId="t1" chosen={new Set()} busy={null} onChoose={noop} onPublish={noop} startOpen />);
    expect(html).toContain("Taken back by the Principal to be corrected: Maths entered wrongly at the initial load.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Publish results</);
    const ready = inContext(<BoardClassPanel cls={{ ...cls, ready: true, subjects: [{ ...cls.subjects[0]!, status: "verified" }] }} terminalId="t1" chosen={new Set()} busy={null} onChoose={noop} onPublish={noop} startOpen />);
    expect(ready).not.toMatch(/<button[^>]*disabled=""[^>]*>Publish results</);
  });

  it("says nothing of it for a class that was never taken back", () => {
    const html = inContext(<BoardClassPanel cls={{ ...cls, takenBack: null }} terminalId="t1" chosen={new Set()} busy={null} onChoose={noop} onPublish={noop} startOpen />);
    expect(html).not.toContain("Taken back");
  });
});
