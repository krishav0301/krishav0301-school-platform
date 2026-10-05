import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import type { Programme } from "@/setup/model";
import { StructurePicker } from "@/setup/StructurePicker";
import { choiceOf, coursesOf, emptyChoice, settle, wingsOf } from "@/setup/structure-picker";

// D-114 (FUT points 4, 9, 14): a level is chosen by Wing, then Course, then Level, in the school's own words.
const level = (id: string, name: string, months: number | null = 12, active = true) => ({ id, ordinal: 1, name, active, usualMonths: months, students: 0, canDelete: false });
const course = (id: string, name: string, wing: [string, string], levels: ReturnType<typeof level>[], active = true): Programme =>
  ({ id, key: id, name, section: { key: wing[0], name: wing[1] }, affiliation: "Board", active, gradingPolicy: null, students: 0, canDelete: false, levels }) as Programme;

const plus2: [string, string] = ["plus2", "+2"];
const bachelors: [string, string] = ["bachelors", "Bachelor's"];
const programmes = [
  course("sci", "Science", plus2, [level("g11", "Grade 11"), level("g12", "Grade 12")]),
  course("mgmt", "Management", plus2, [level("m11", "Grade 11"), level("m12", "Grade 12", 12, false)]),
  course("bbs", "BBS", bachelors, [level("y1", "Year 1"), level("y2", "Year 2")]),
  course("old", "Old", bachelors, [level("o1", "Year 1")], false),
  course("mba", "MBA Finance", ["masters", "Master's"], [level("q1", "Quarter 1", 3)]),
];

describe("which wings, courses and levels are offered", () => {
  it("only switched-on courses and levels, and only wings with something to offer", () => {
    expect(wingsOf(programmes).map((w) => w.key)).toEqual(["plus2", "bachelors", "masters"]);
    expect(coursesOf(programmes, "bachelors").map((p) => p.id)).toEqual(["bbs"]); // Old is switched off
    const threeMonths = (l: { usualMonths: number | null }) => l.usualMonths === 3;
    expect(wingsOf(programmes, threeMonths).map((w) => w.key)).toEqual(["masters"]);
  });

  it("settles a step with one choice, and clears a choice no longer offered", () => {
    expect(settle(programmes, { sectionKey: "bachelors", programmeId: null, levelId: null })).toEqual({ sectionKey: "bachelors", programmeId: "bbs", levelId: null });
    expect(settle(programmes, { sectionKey: "masters", programmeId: null, levelId: null })).toEqual({ sectionKey: "masters", programmeId: "mba", levelId: "q1" });
    expect(settle(programmes, { sectionKey: "plus2", programmeId: "bbs", levelId: "y1" })).toEqual({ sectionKey: "plus2", programmeId: null, levelId: null });
    expect(settle(programmes, emptyChoice)).toEqual(emptyChoice); // three wings: nothing to settle
  });

  it("finds where a level sits", () => {
    expect(choiceOf(programmes, "m11")).toEqual({ sectionKey: "plus2", programmeId: "mgmt", levelId: "m11" });
    expect(choiceOf(programmes, "nope")).toEqual(emptyChoice);
  });
});

describe("the picker", () => {
  const config = { terms: { "term.section": "Wing", "term.programme": "Course", "term.level": "Level" }, modules: {} } as unknown as PublicConfig;
  const render = (node: React.ReactNode) => renderToStaticMarkup(<ConfigContext.Provider value={makeConfigValue("ready", config)}>{node}</ConfigContext.Provider>);

  it("asks for the wing first, in the school's words", () => {
    const html = render(<StructurePicker programmes={programmes} value={emptyChoice} onChange={() => {}} empty="None" />);
    expect(html).toContain(">Wing<");
    expect(html).not.toContain(">Course<");
    expect(html).toContain(">+2<");
  });

  it("states a single choice instead of offering a menu of one entry (D-030)", () => {
    const html = render(<StructurePicker programmes={programmes} value={{ sectionKey: "bachelors", programmeId: null, levelId: null }} onChange={() => {}} empty="None" />);
    expect(html).toContain("BBS"); // the only course, said in a line
    expect(html).not.toContain(">Course<");
    expect(html).toContain(">Level<");
  });

  it("says when there is nothing to choose", () => {
    expect(render(<StructurePicker programmes={programmes} keep={() => false} value={emptyChoice} onChange={() => {}} empty="No level fits." />)).toContain("No level fits.");
  });

  it("says a problem at the first step still to choose", () => {
    const html = render(<StructurePicker programmes={programmes} value={emptyChoice} onChange={() => {}} empty="None" error="Choose one" />);
    expect(html).toMatch(/>Wing<[\s\S]*Choose one/);
  });
});
