import { describe, expect, it } from "vitest";

import type { SetupMap } from "@/setup/model";
import { GAP_X, buildTree, closing, findNode, layoutTree, openingPath, pathTo, searchTree, sizeOf } from "@/setup/structure/model";

// The Academic Structure as a tree (the PM, 2026-10-12): uneven on purpose, two wings, courses with one and with many
// levels, a level with no sections, a section with no name, and a big class.

const sections = (n: number, students: number) => Array.from({ length: n }, (_, i) => ({ id: `c${n}-${i}-${students}`, label: String.fromCharCode(65 + i), students, classTeacher: i === 0 ? "Sita Rai" : null, teachers: [] }));
const subject = (id: string, name: string) => ({ id, name, fullMarksHundredths: 10_000, practicalHundredths: null, group: null });

const map: SetupMap = {
  terms: [
    {
      id: "t1",
      label: "Term 2083",
      status: "active",
      exam: null,
      wings: [
        {
          key: "school",
          name: "Secondary School",
          departments: [
            {
              id: "d-general",
              name: "General",
              levels: [
                { id: "l8", name: "Class 8", subjects: [subject("s1", "English"), subject("s2", "Science")], sections: sections(1, 29) },
                { id: "l9", name: "Class 9", subjects: [subject("s1", "English")], sections: sections(2, 29) },
                { id: "l10", name: "Class 10", subjects: [], sections: [] },
              ],
            },
            { id: "d-sci", name: "Science", levels: [{ id: "l11", name: "Grade 11", subjects: [subject("s3", "Physics")], sections: [{ id: "big", label: "", students: 400, classTeacher: null, teachers: [] }] }] },
          ],
        },
        { key: "plus2", name: "Higher Secondary", departments: [{ id: "d-mgmt", name: "Management", levels: [{ id: "l12", name: "Grade 12", subjects: [], sections: sections(3, 40) }] }] },
      ],
    },
  ],
};
const term = map.terms[0]!;
const tree = buildTree(term);

describe("the structure tree", () => {
  it("adds every count up from the sections, for the term, each wing, each course and each class", () => {
    expect(tree.counts).toEqual({ courses: 3, classes: 5, sections: 7, students: 29 + 58 + 400 + 120 });
    const wing = findNode(tree, "wing:school")!;
    expect(wing.counts).toEqual({ courses: 2, classes: 4, sections: 4, students: 29 + 58 + 400 });
    expect(findNode(tree, "course:d-general")!.counts).toMatchObject({ classes: 3, sections: 3, students: 87 });
    expect(findNode(tree, "level:l9")!.counts).toMatchObject({ classes: 1, sections: 2, students: 58 });
  });

  it("puts a level's subjects and its sections under it, and no subjects node where there are none", () => {
    expect(findNode(tree, "level:l9")!.children.map((c) => c.kind)).toEqual(["subjects", "section", "section"]);
    expect(findNode(tree, "level:l10")!.children).toEqual([]);
    expect(findNode(tree, "level:l12")!.children.map((c) => c.kind)).toEqual(["section", "section", "section"]);
  });

  it("names a section with no label, and never draws a student", () => {
    expect(findNode(tree, "section:big")!.name).toBe("Section");
    expect(buildTree(term, "Unnamed")).toBeTruthy();
    expect(JSON.stringify(tree.counts)).not.toContain("NaN");
  });

  it("gives the way down to a node, and what opening it leaves open: that way, and nothing else", () => {
    expect(pathTo(tree, "section:c1-0-29").map((n) => n.kind)).toEqual(["term", "wing", "course", "level", "section"]);
    expect([...openingPath(tree, "level:l9")]).toEqual(["term:t1", "wing:school", "course:d-general", "level:l9"]);
    expect(pathTo(tree, "nope")).toEqual([]);
  });

  it("closing a node closes what is below it and leaves the rest open", () => {
    const open = openingPath(tree, "level:l9");
    expect([...closing(tree, open, "course:d-general")]).toEqual(["term:t1", "wing:school"]);
  });
});

describe("searching the structure", () => {
  it("finds wings, courses, classes, sections and subjects, each with where it sits", () => {
    expect(searchTree(tree, "science").map((h) => [h.kind, h.label, h.place])).toEqual([
      ["subjects", "Science", "Secondary School / General / Class 8"],
      ["course", "Science", "Secondary School"],
    ]);
    expect(searchTree(tree, "grade 12")[0]).toMatchObject({ kind: "level", place: "Higher Secondary / Management" });
    expect(searchTree(tree, "  ")).toEqual([]);
    expect(searchTree(tree, "english").map((h) => h.id)).toEqual(["subjects:l8", "subjects:l9"]);
  });

  it("stops at the limit", () => {
    expect(searchTree(tree, "c", 3)).toHaveLength(3);
  });
});

describe("laying the picture out", () => {
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const noneOverlap = (open: Set<string>) => {
    const { boxes } = layoutTree(tree, open);
    const all = [...boxes.values()];
    return all.every((a, i) => all.every((b, j) => i === j || !overlaps(a, b)));
  };

  it("shows only the term while nothing is open, and its wings when the term is", () => {
    expect([...layoutTree(tree, new Set()).boxes.keys()]).toEqual(["term:t1"]);
    const l = layoutTree(tree, new Set(["term:t1"]));
    expect([...l.boxes.keys()]).toEqual(["term:t1", "wing:school", "wing:plus2"]);
    expect(l.edges).toEqual([{ from: "term:t1", to: "wing:school" }, { from: "term:t1", to: "wing:plus2" }]);
  });

  it("keeps the term centred over its wings, one row for each depth, with the gap between neighbours", () => {
    const { boxes } = layoutTree(tree, new Set(["term:t1"]));
    const [term1, a, b] = [boxes.get("term:t1")!, boxes.get("wing:school")!, boxes.get("wing:plus2")!];
    expect(a.y).toBe(b.y);
    expect(b.y).toBeGreaterThan(term1.y);
    expect(b.x - (a.x + a.w)).toBe(GAP_X);
    expect(term1.x + term1.w / 2).toBeCloseTo((a.x + b.x + b.w) / 2, 5);
  });

  it("never overlaps, however much is open, and opening a branch widens only the room it needs", () => {
    expect(noneOverlap(openingPath(tree, "level:l9"))).toBe(true);
    expect(noneOverlap(openingPath(tree, "level:l12"))).toBe(true);
    expect(noneOverlap(new Set(allIds()))).toBe(true);
    const narrow = layoutTree(tree, new Set(["term:t1"])).width;
    const wide = layoutTree(tree, openingPath(tree, "level:l12")).width;
    expect(wide).toBeGreaterThanOrEqual(narrow);
    expect(layoutTree(tree, openingPath(tree, "level:l12")).boxes.get("level:l12")!.w).toBe(sizeOf(findNode(tree, "level:l12")!).w);
  });

  it("draws one box for each of the open nodes and one connector for each but the root", () => {
    const open = openingPath(tree, "level:l9");
    const { boxes, edges } = layoutTree(tree, open);
    expect(edges).toHaveLength(boxes.size - 1);
  });
});

function allIds(): string[] {
  const ids: string[] = [];
  const walk = (n: { id: string; children: { id: string; children: unknown[] }[] }) => {
    ids.push(n.id);
    n.children.forEach((c) => walk(c as never));
  };
  walk(tree as never);
  return ids;
}

describe("the size of each box", () => {
  it("draws only the school's own boxes: no empty box to press at the end of a branch", () => {
    const kinds = (n: { kind: string; children: unknown[] }): string[] => [n.kind, ...(n.children as { kind: string; children: unknown[] }[]).flatMap(kinds)];
    expect(new Set(kinds(tree))).toEqual(new Set(["term", "wing", "course", "level", "subjects", "section"]));
    const everything = layoutTree(tree, allIdsOf(tree));
    expect(everything.boxes.size).toBe(kinds(tree).length);
  });

  it("each kind has one size, rows are as tall as their tallest box, and rows never overlap", () => {
    const l = layoutTree(tree, openingPath(tree, "level:l9"));
    const rows = new Map<number, number[]>();
    for (const b of l.boxes.values()) rows.set(b.y, [...(rows.get(b.y) ?? []), b.h]);
    const tops = [...rows.keys()].sort((a, b) => a - b);
    tops.forEach((top, i) => {
      if (i > 0) expect(top).toBeGreaterThanOrEqual(tops[i - 1]! + Math.max(...rows.get(tops[i - 1]!)!));
    });
    expect(l.height).toBeGreaterThan(Math.max(...[...l.boxes.values()].map((b) => b.y + b.h)));
    expect(sizeOf(findNode(tree, "wing:school")!).w).toBeGreaterThanOrEqual(300);
  });
});

function allIdsOf(root: { id: string; children: unknown[] }): Set<string> {
  const ids = new Set<string>([root.id]);
  for (const c of root.children as { id: string; children: unknown[] }[]) allIdsOf(c).forEach((x) => ids.add(x));
  return ids;
}
