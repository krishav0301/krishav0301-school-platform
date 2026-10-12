import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SessionContext } from "@/session/SessionProvider";
import { SetupMapView } from "@/setup/SetupMapScreen";
import type { SetupMap } from "@/setup/model";
import { buildTree, findNode, openingPath } from "@/setup/structure/model";
import { StructureDetail } from "@/setup/structure/StructureDetail";
import { StructureFlowView } from "@/setup/structure/StructureFlowView";
import { StructureListView } from "@/setup/structure/StructureListView";
import { termWords } from "@/setup/model";
import { fakeSession } from "./session";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/setup/map", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

// The Academic Structure (the PM, 2026-10-12, D-157): the school as a tree to explore one branch at a time, as a chart or a list.
const config = { terms: { "term.section": "Wing", "term.programme": "Course", "term.level": "Class", "term.classSection": "Section" }, modules: {} } as unknown as PublicConfig;
const as = (role: string) => fakeSession({ status: "signedIn", me: { id: "u1", name: "Asha", roles: [{ role, scope: "institution" }] } });
const render = (node: React.ReactNode, role = "coordinator") =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={as(role)}>{node}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

const map: SetupMap = {
  terms: [
    {
      id: "t1",
      label: "BS 2083 Baisakh",
      status: "active",
      exam: { graded: true, theoryMinPercent: 35, practicalMinPercent: 40, terminals: [{ name: "First", weight: 40, hasPractical: false }, { name: "Final", weight: 60, hasPractical: true }] },
      wings: [
        {
          key: "plus2",
          name: "+2",
          departments: [
            {
              id: "d1",
              name: "Science",
              levels: [
                {
                  id: "l1",
                  name: "Grade 11",
                  subjects: [
                    { id: "s1", name: "Physics", fullMarksHundredths: 10_000, practicalHundredths: 2_500, group: null },
                    { id: "s2", name: "English", fullMarksHundredths: 10_000, practicalHundredths: null, group: null },
                  ],
                  sections: [
                    { id: "c1", label: "Morning", students: 32, classTeacher: "Sita Rai", teachers: [{ subjectId: "s1", teacher: "Ram Karki" }] },
                    { id: "c2", label: "", students: 0, classTeacher: null, teachers: [] },
                  ],
                },
                { id: "l2", name: "Grade 12", subjects: [], sections: [] },
              ],
            },
          ],
        },
        { key: "school", name: "School", departments: [] },
      ],
    },
    { id: "t2", label: "BS 2083 Shrawan", status: "draft", exam: null, wings: [] },
  ],
};
const term = map.terms[0]!;
const tree = buildTree(term);
const words = termWords((key) => (config.terms as Record<string, string>)[key] ?? key);

describe("the Academic Structure page", () => {
  it("says so when no term is open", () => {
    expect(render(<SetupMapView map={{ terms: [] }} />)).toContain("There is no open term yet.");
  });

  it("opens on the term and its wings, in the school's words, with the courses still shut", () => {
    const html = render(<SetupMapView map={map} />);
    expect(html).toContain("BS 2083 Baisakh");
    expect(html).toContain('aria-label="Details of Wing +2"');
    expect(html).toContain('aria-label="Details of Wing School"');
    expect(html).not.toContain("Science");
    expect(html).toContain("Running");
    expect(html).toContain("Flow view");
    expect(html).toContain("List view");
  });

  it("offers a choice of term when several are open, and each wing's counts", () => {
    const html = render(<SetupMapView map={map} />);
    expect(html).toContain("Academic term");
    expect(html).toContain("BS 2083 Shrawan");
    expect(html).toContain("1 course · 2 classes · 2 sections · 32 students");
  });

  it("has a search, the path to where you are, and a way to Settings", () => {
    const html = render(<SetupMapView map={map} termHref="/portal/terms" />);
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-label="Where you are"');
    expect(html).toContain('href="/portal/terms"');
  });
});

describe("the chart", () => {
  const flow = (open: Set<string>, selectedId: string | null = null) =>
    render(<StructureFlowView root={tree} open={open} selectedId={selectedId} words={words} onSelect={() => {}} onToggle={() => {}} />);

  it("draws only what is open, with a connector for each box inside another", () => {
    const shut = flow(new Set(["term:t1"]));
    expect(shut.match(/data-node-id=/g)).toHaveLength(3); // the term and two wings
    expect(shut.match(/ d="M /g)).toHaveLength(2);
    const deep = flow(openingPath(tree, "level:l1"));
    expect(deep.match(/data-node-id=/g)).toHaveLength(9); // + the course, its two classes, and the open class's subjects and two sections
    expect(deep).toContain('aria-expanded="true"');
    expect(deep).toContain("Subjects");
    expect(deep).toContain("Morning");
  });

  it("gives every box a name for a screen reader, an arrow where it holds others, and the zoom controls", () => {
    const html = flow(new Set(["term:t1"]), "wing:plus2");
    expect(html).toContain('aria-label="Open +2"');
    expect(html).toContain('aria-pressed="true"');
    for (const label of ["Zoom in", "Zoom out", "Fit to screen", "Reset zoom"]) expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain("100%");
    expect(html).toContain('aria-label="Academic structure chart"');
  });

  it("puts no student in the picture, however many there are", () => {
    const html = flow(openingPath(tree, "level:l1"));
    expect(html).toContain("32 students");
    expect(html).not.toMatch(/Student \d/);
  });
});

describe("the list", () => {
  it("is the same tree as nested rows, with the same open boxes", () => {
    const html = render(<StructureListView root={tree} open={openingPath(tree, "level:l1")} selectedId="level:l1" words={words} onSelect={() => {}} onToggle={() => {}} />);
    expect(html).toContain('role="tree"');
    expect(html.match(/role="treeitem"/g)).toHaveLength(9);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Grade 12");
    expect(html).toContain("Morning");
  });
});

describe("a box's details", () => {
  const detail = (id: string, role: string, canFocus = false) =>
    render(<StructureDetail node={findNode(tree, id)!} words={words} reach={{ structure: role === "coordinator", programmes: role === "admin" }} termHref="/portal/setup" canFocus={canFocus} onFocus={() => {}} onClose={() => {}} />, role);

  it("a section shows its Class Teacher, who teaches each subject, and where to open the class and its students", () => {
    const html = detail("section:c1", "coordinator");
    expect(html).toContain("Sita Rai");
    expect(html).toContain("Physics: ");
    expect(html).toContain("Ram Karki");
    expect(html).toContain("No teacher yet");
    expect(html).toContain('href="/portal/classes/class?id=c1"');
    expect(html).toContain('href="/portal/classes/class?id=c1&amp;tab=students"');
    expect(html).toContain("View students (32)");
    expect(html).toContain('href="/portal/setup/teaching"');
  });

  it("someone who cannot change the setup is shown no link to change it, only to read the class", () => {
    const html = detail("section:c1", "admin");
    expect(html).not.toContain('href="/portal/setup/teaching"');
    expect(html).toContain('href="/portal/classes/class?id=c1"');
    expect(detail("level:l1", "admin")).not.toContain("/portal/setup/curriculum");
    expect(detail("level:l1", "coordinator")).toContain('href="/portal/setup/curriculum"');
  });

  it("a wing or a course offers wings, courses and levels to the Principal, and Focus where it can", () => {
    expect(detail("wing:plus2", "admin", true)).toContain('href="/portal/setup/programmes"');
    expect(detail("wing:plus2", "coordinator")).not.toContain('href="/portal/setup/programmes"');
    expect(detail("course:d1", "admin", true)).toContain("Focus on this");
    expect(detail("course:d1", "admin", false)).not.toContain("Focus on this");
  });

  it("the term shows its exam pattern compactly, and a level its subjects and sections", () => {
    const html = detail("term:t1", "coordinator");
    expect(html).toContain("Out of 100");
    expect(html).toContain("First · 40%");
    expect(html).toContain("Final · 60% · practical");
    expect(html).toContain('href="/portal/setup/terminals"');
    const level = detail("level:l1", "coordinator");
    expect(level).toContain("Physics");
    expect(level).toContain("Morning");
  });
});
