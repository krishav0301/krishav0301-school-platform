import { describe, expect, it } from "vitest";

import type { Board } from "@/promotion/client";
import { choices, promotionFigures, proposed, toMove } from "@/promotion/PromotionScreen";

/** Moving students on (D-110): what the Co-ordinator is offered for each student, and what is proposed. */

const targets: Board["targets"] = [
  { classId: "c2a", className: "BCA · Semester 2 (A)", levelId: "s2", termLabel: "BCA even" },
  { classId: "c2b", className: "BCA · Semester 2 (B)", levelId: "s2", termLabel: "BCA even" },
  { classId: "c1", className: "BCA · Semester 1 (A)", levelId: "s1", termLabel: "BCA even" },
];
const cls = (levelId: string, nextLevelId: string | null): Board["classes"][number] => ({ classId: "x", className: "BCA · Semester 1 (A)", levelId, nextLevelId, nextLevelName: nextLevelId ? "Semester 2" : null, students: [] });

describe("the choices for a student", () => {
  it("promote into each class of the next level, repeat in a class of the same level, or leave; Promote is proposed", () => {
    const options = choices(cls("s1", "s2"), targets);
    expect(options.map((o) => o.value)).toEqual(["promote:c2a", "promote:c2b", "repeat:c1", "leave"]);
    expect(options[0]!.label).toBe("Promote to BCA · Semester 2 (A) (BCA even)");
    expect(proposed(cls("s1", "s2"), targets)).toBe("promote:c2a");
  });

  it("at the last level the student graduates; that is proposed", () => {
    expect(choices(cls("s8", null), targets).map((o) => o.value)).toEqual(["graduate", "leave"]);
    expect(proposed(cls("s8", null), targets)).toBe("graduate");
  });

  it("a choice becomes the move the API takes", () => {
    expect(toMove("e1", "promote:c2a")).toEqual({ enrollmentId: "e1", action: "promote", classId: "c2a" });
    expect(toMove("e1", "leave")).toEqual({ enrollmentId: "e1", action: "leave" });
  });
});

describe("the figures", () => {
  it("count those still to move, moved on, left or graduated, and those waiting with dues", () => {
    const student = (outcome: Board["classes"][number]["students"][number]["outcome"], balancePaisa = 0) => ({ enrollmentId: outcome + balancePaisa, studentId: "s", sid: "1", name: "A", rollNo: null, balancePaisa, outcome, movedTo: null });
    const board: Board = { terms: [], termId: "t", targets, classes: [{ ...cls("s1", "s2"), students: [student("pending", 500), student("pending"), student("promoted"), student("left"), student("graduated")] }] };
    expect(promotionFigures(board).map((f) => f.value)).toEqual(["2", "1", "2", "1"]);
  });
});
