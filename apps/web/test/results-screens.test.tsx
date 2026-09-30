import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SheetGrid, draftOf } from "@/results/MarkSheetScreen";
import { formatMarks, markText, parseMark, scoreText, type MarkSheet } from "@/results/model";
import { ResultsHome } from "@/results/ResultsHome";
import { ResultsTabs } from "@/results/ResultsTabs";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";

vi.mock("next/navigation", () => ({
  usePathname: () => "/portal/results",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const config = (top20: boolean): PublicConfig => ({
  school: {
    name: royal.school.name,
    shortName: royal.school.shortName,
    currency: "NPR",
    timezone: "Asia/Kathmandu",
    region: "nepal",
    template: null,
  },
  sections: royal.sections,
  modules: { results: true, top20 },
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
});
const as = (role: string, scope: "institution" | "own" | "assigned" = "institution") =>
  fakeSession({
    status: "signedIn",
    me: { name: "Asha", roles: [{ role, scope }] },
  });
const inContext = (element: React.ReactNode, session = as("coordinator"), top20 = true) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config(top20))}>
      <SessionContext.Provider value={session}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

describe("marks as typed and shown", () => {
  it("reads a number with up to two decimals, AB for absent, or blank; nothing else", () => {
    expect(parseMark("62.5")).toEqual({ valueHundredths: 6250, absent: false });
    expect(parseMark(" 70 ")).toEqual({ valueHundredths: 7000, absent: false });
    expect(parseMark("0.25")).toEqual({ valueHundredths: 25, absent: false });
    expect(parseMark("ab")).toEqual({ valueHundredths: null, absent: true });
    expect(parseMark("")).toEqual({ valueHundredths: null, absent: false });
    for (const bad of ["-1", "1.234", "7O", "1,000", "1e2"]) expect(parseMark(bad)).toBeNull();
  });

  it("writes whole hundredths the short way, with no floats", () => {
    expect([6250, 7000, 25, 5, 10].map(formatMarks)).toEqual(["62.5", "70", "0.25", "0.05", "0.1"]);
    expect(markText({ valueHundredths: null, absent: true })).toBe("AB");
    expect(scoreText({ gpaHundredths: 382, percentHundredths: null })).toBe("3.82");
    expect(scoreText({ gpaHundredths: null, percentHundredths: 8650 })).toBe("86.50%");
  });
});

const sheet: MarkSheet = {
  sheetId: "s1",
  classId: "c1",
  programmeName: "Science",
  levelName: "Grade 11",
  label: "",
  offeringId: "o1",
  subjectName: "Physics",
  terminal: { id: "t1", name: "First terminal" },
  teacherName: "Gita Rai",
  status: "draft",
  note: null,
  components: [
    { id: "th", name: "Theory", kind: "theory", maxHundredths: 7500 },
    { id: "pr", name: "Practical", kind: "practical", maxHundredths: 2500 },
  ],
  students: [
    {
      enrollmentId: "e1",
      sid: "2083-00001",
      name: "Sita Sharma",
      rollNo: 1,
      marks: [
        { componentId: "th", valueHundredths: 6250, absent: false },
        { componentId: "pr", valueHundredths: null, absent: true },
      ],
    },
    {
      enrollmentId: "e2",
      sid: "2083-00002",
      name: "Hari Thapa",
      rollNo: 2,
      marks: [
        { componentId: "th", valueHundredths: null, absent: false },
        { componentId: "pr", valueHundredths: null, absent: false },
      ],
    },
  ],
  missing: 2,
};

describe("the marks grid", () => {
  it("labels every box with the student and component, shows the maximum and kind, and starts from the saved marks", () => {
    const html = inContext(<SheetGrid sheet={sheet} draft={draftOf(sheet)} editable />);
    expect(html).toContain('aria-label="Theory for Sita Sharma"');
    expect(html).toContain("Theory (of 75)");
    expect(html).toContain("Practical, practical (of 25)");
    expect(html).toContain('value="62.5"');
    expect(html).toContain('value="AB"');
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('<th scope="row">Sita Sharma');
  });

  it("read-only shows the marks as text, with no boxes", () => {
    const html = inContext(<SheetGrid sheet={sheet} draft={draftOf(sheet)} editable={false} />);
    expect(html).not.toContain("<input");
    expect(html).toContain("62.5");
  });
});

describe("results places", () => {
  it("the Co-ordinator gets Review, Rechecks, Class sheets, Electives and Top 20; the Admin Changes, Class sheets and Top 20", () => {
    const coordinator = inContext(<ResultsTabs pathname="/portal/results" />);
    for (const href of ["/portal/results/rechecks", "/portal/results/sheets", "/portal/results/electives", "/portal/results/top20"]) expect(coordinator).toContain(href);
    const admin = inContext(<ResultsTabs pathname="/portal/results" />, as("admin"));
    expect(admin).toContain("Changes");
    expect(admin).not.toContain("/portal/results/electives");
    expect(admin).not.toContain(">Review<");
  });

  it("no Top 20 tab where the school switched it off; no tabs for a teacher or a student", () => {
    expect(inContext(<ResultsTabs pathname="/portal/results" />, as("coordinator"), false)).not.toContain("/portal/results/top20");
    expect(inContext(<ResultsTabs pathname="/portal/results" />, as("teacher", "assigned"))).toBe("");
    expect(inContext(<ResultsTabs pathname="/portal/results" />, as("student", "own"))).toBe("");
  });

  it("each role lands on its own place, showing the shape of the page while it loads", () => {
    expect(inContext(<ResultsHome />, as("student", "own"))).toContain("Your results");
    expect(inContext(<ResultsHome />, as("teacher", "assigned"))).toContain("Marks");
    expect(inContext(<ResultsHome />)).toContain("Review results");
    expect(inContext(<ResultsHome />, as("admin"))).toContain("Changes after publishing");
    expect(inContext(<ResultsHome />)).toMatch(/role="status"[^>]*aria-busy="true"/);
  });
});
