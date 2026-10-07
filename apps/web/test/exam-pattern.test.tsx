import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SessionContext } from "@/session/SessionProvider";
import {
  canSave,
  draftFrom,
  editability,
  examProblem,
  isDirty,
  patternState,
  remainingWeight,
  toInput,
  totalWeight,
  withExam,
  withoutExam,
  type Draft,
  type DraftExam,
} from "@/setup/exam-pattern-model";
import type { ExamPattern } from "@/setup/model";
import { AddExamDialog, ExamForm, ExamsTable, Overview, PatternBoard, PatternPanel, StatusCard, statusShape } from "@/setup/TerminalsScreen";
import royal from "../../../packs/royal-softech/pack.json";
import { fakeSession } from "./session";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/setup/terminals", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: {},
  terms: { "term.programme": "Programme", "term.level": "Level", "term.section": "Section", "term.terminal": "Exam", "role.coordinator": "Vice Principal", "role.student": "Student" },
  theme: royal.theme as PublicConfig["theme"],
};
const as = (role: string) => fakeSession({ status: "signedIn", me: { name: "Sita", roles: [{ role, scope: "institution" }] } });
const inContext = (element: React.ReactNode, session = as("coordinator")) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={session}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

const exam = (name: string, weight: number, hasPractical = false, id?: string): DraftExam => ({ name, weight, hasPractical, ...(id ? { id } : {}) });
const three = [exam("1st Term", 30, false, "e1"), exam("2nd Term", 30, false, "e2"), exam("Final Term", 40, true, "e3")];
const saved = (over: Partial<ExamPattern> = {}): ExamPattern => ({
  term: { id: "y", label: "School 2025-26", status: "active" },
  pattern: { graded: false, theoryMinPercent: 35, practicalMinPercent: 40, gradeBands: null },
  terminals: three.map((x, i) => ({ id: x.id!, yearId: "y", name: x.name, ordinal: i + 1, weight: x.weight, hasPractical: x.hasPractical })),
  locked: false,
  ...over,
});
const empty = (): ExamPattern => saved({ pattern: null, terminals: [] });

describe("what the draft works out for itself (D-132)", () => {
  it("total, what is left and where the pattern stands come from the exams, never typed in", () => {
    expect(totalWeight(three)).toBe(100);
    expect(remainingWeight(three)).toBe(0);
    expect(remainingWeight(three.slice(0, 2))).toBe(40);
    expect(patternState([])).toBe("empty");
    expect(patternState(three.slice(0, 2))).toBe("incomplete");
    expect(patternState(three)).toBe("complete");
    expect(patternState([...three, exam("Extra", 10)])).toBe("over");
    expect(remainingWeight([...three, exam("Extra", 10)])).toBe(0);
  });

  it("an exam is checked in the order the form shows: name, duplicate, then weight against what is left", () => {
    const two = three.slice(0, 2);
    expect(examProblem(two, { name: " ", weight: "40" })).toEqual({ field: "name", reason: "required" });
    expect(examProblem(two, { name: "  1st TERM ", weight: "40" })).toEqual({ field: "name", reason: "duplicate" });
    expect(examProblem(two, { name: "Final Term", weight: "" })).toEqual({ field: "weight", reason: "required" });
    expect(examProblem(two, { name: "Final Term", weight: "1.5" })).toEqual({ field: "weight", reason: "notWhole" });
    expect(examProblem(two, { name: "Final Term", weight: "abc" })).toEqual({ field: "weight", reason: "notWhole" });
    expect(examProblem(two, { name: "Final Term", weight: "0" })).toEqual({ field: "weight", reason: "zero" });
    expect(examProblem(two, { name: "Final Term", weight: "50" })).toEqual({ field: "weight", reason: "tooMuch", remaining: 40 }); // 110%
    expect(examProblem(two, { name: "Final Term", weight: "40" })).toBeNull(); // 100%
    expect(examProblem(two, { name: "Final Term", weight: "30" })).toBeNull(); // 90%: allowed, the pattern is then incomplete
  });

  it("changing an exam leaves its own name and weight out of the checks", () => {
    expect(examProblem(three, { name: "Final Term", weight: "40" }, 2)).toBeNull();
    expect(examProblem(three, { name: "Final Term", weight: "41" }, 2)).toEqual({ field: "weight", reason: "tooMuch", remaining: 40 });
    expect(examProblem(three, { name: "1st term", weight: "40" }, 2)).toEqual({ field: "name", reason: "duplicate" });
  });

  it("adding, changing and removing keep the order and a saved exam's id", () => {
    const added = withExam(three.slice(0, 2), exam("Final Term", 40, true));
    expect(added.map((x) => x.name)).toEqual(["1st Term", "2nd Term", "Final Term"]);
    const changed = withExam(three, exam("Midterm", 30, true), 1);
    expect(changed[1]).toEqual({ id: "e2", name: "Midterm", weight: 30, hasPractical: true });
    expect(withoutExam(three, 0).map((x) => x.id)).toEqual(["e2", "e3"]);
  });

  it("it can be saved only at exactly 100 with valid settings, and then goes to the server as the PM set it", () => {
    const draft = draftFrom(saved());
    expect(canSave(draft)).toBe(true);
    expect(canSave({ ...draft, exams: draft.exams.slice(0, 2) })).toBe(false);
    expect(canSave({ ...draft, exams: [...draft.exams, exam("Extra", 5)] })).toBe(false);
    expect(canSave({ ...draft, settings: { ...draft.settings, theoryMin: "x" } })).toBe(false);
    expect(canSave({ ...draft, settings: { ...draft.settings, graded: true } })).toBe(false); // a grade with no letter
    const input = toInput(draft);
    expect(input.graded).toBe(false);
    expect(input.gradeBands).toBeNull();
    expect(input.theoryMinPercent).toBe(35);
    expect(input.practicalMinPercent).toBe(40);
    expect(input.terminals).toEqual([
      { id: "e1", name: "1st Term", weight: 30, hasPractical: false },
      { id: "e2", name: "2nd Term", weight: 30, hasPractical: false },
      { id: "e3", name: "Final Term", weight: 40, hasPractical: true },
    ]);
  });

  it("a new exam goes without an id, and its practical choice is always stated", () => {
    const draft: Draft = { ...draftFrom(empty()), exams: [exam("Only", 100, false)] };
    expect(toInput(draft).terminals).toEqual([{ name: "Only", weight: 100, hasPractical: false }]);
  });

  it("unsaved changes are noticed, and a name's spaces are not a change", () => {
    const draft = draftFrom(saved());
    expect(isDirty(draft, saved())).toBe(false);
    expect(isDirty({ ...draft, exams: draft.exams.map((x, i) => (i === 0 ? { ...x, name: " 1st Term " } : x)) }, saved())).toBe(false);
    expect(isDirty({ ...draft, exams: draft.exams.slice(0, 2) }, saved())).toBe(true);
    expect(isDirty({ ...draft, settings: { ...draft.settings, theoryMin: "40" } }, saved())).toBe(true);
  });

  it("marks lock the pattern first; then a closed term; then who may change it", () => {
    expect(editability(saved({ locked: true }), true)).toEqual({ editable: false, why: "locked" });
    expect(editability(saved({ locked: true, term: { id: "y", label: "x", status: "closed" } }), true)).toEqual({ editable: false, why: "locked" });
    expect(editability(saved({ term: { id: "y", label: "x", status: "closed" } }), true)).toEqual({ editable: false, why: "closed" });
    expect(editability(saved(), false)).toEqual({ editable: false, why: "notAllowed" });
    expect(editability(saved(), true)).toEqual({ editable: true });
  });
});

describe("where the pattern stands", () => {
  it("is set when saved and complete, unsaved when changed, incomplete or over otherwise, and nothing when empty", () => {
    expect(statusShape("complete", false, true)?.title).toBe("pattern.set.title");
    expect(statusShape("complete", true, true)?.title).toBe("pattern.unsaved.title");
    expect(statusShape("complete", true, false)?.title).toBe("pattern.set.title"); // a reader has no changes of their own
    expect(statusShape("incomplete", true, true)?.title).toBe("pattern.incomplete.title");
    expect(statusShape("over", true, true)?.title).toBe("pattern.over.title");
    expect(statusShape("empty", false, true)).toBeNull();
  });

  it("an incomplete pattern says how much of the weight is still unallocated", () => {
    const html = inContext(<StatusCard shape={statusShape("incomplete", true, true)!} term="School 2025-26" total={60} actions={null} />);
    expect(html).toContain("Exam pattern is incomplete");
    expect(html).toContain("40% of the exam weight is still unallocated.");
  });

  it("a set pattern names the term it applies to", () => {
    const html = inContext(<StatusCard shape={statusShape("complete", false, true)!} term="School 2025-26" total={100} actions={null} />);
    expect(html).toContain("Exam pattern is set for this term");
    expect(html).toContain("This pattern is applied to all classes in School 2025-26.");
  });
});

describe("the three figures and the exams", () => {
  it("count the exams and add the weight up from the draft", () => {
    const html = inContext(<Overview exams={three} />);
    expect(html).toContain("Total exams");
    expect(html).toContain(">3<");
    expect(html).toContain("Total weight");
    expect(html).toContain(">100<");
    expect(html).toContain("Fixed for term");
    expect(html).toContain("Same for all classes");
    expect(inContext(<Overview exams={three.slice(0, 2)} />)).toContain(">60<");
  });

  const ids = new Set(["e1", "e2"]);
  it("the table has the six columns, a status pill for each exam, and a menu while it can change", () => {
    const html = inContext(<ExamsTable exams={three} savedIds={ids} editable onEdit={() => {}} onRemove={() => {}} />);
    for (const head of [">#<", ">Exam name<", ">Weight (%)<", ">Practical<", ">Status<", ">Actions<"]) expect(html).toContain(head);
    expect(html).toContain("No (theory only)");
    expect(html).toContain("Yes (theory + practical)");
    expect(html).toContain(">Active<");
    expect(html).toContain(">Not saved yet<"); // Final Term is not saved
    expect(html).toContain('aria-label="Actions for 1st Term"');
    expect(html).toContain("Total: 100%");
  });

  it("a locked pattern shows Locked on every row and offers no way to edit or remove", () => {
    const html = inContext(<ExamsTable exams={three} savedIds={new Set(["e1", "e2", "e3"])} editable={false} onEdit={() => {}} onRemove={() => {}} />);
    expect(html).not.toContain("Actions for");
    expect(html.match(/>Locked</g)).toHaveLength(3);
  });
});

describe("the add exam form", () => {
  const two = three.slice(0, 2);

  it("asks for the name, the weight and whether there is a practical, theory only to begin with", () => {
    const html = inContext(<ExamForm exams={two} onDone={() => {}} />);
    expect(html).toContain("Add an exam to this term&#x27;s pattern.");
    expect(html).toContain("Exam name");
    expect(html).toContain("e.g. 1st Term, 2nd Term, Final Term");
    expect(html).toContain("Choose a clear name to identify this exam.");
    expect(html).toContain("Weight (%)");
    expect(html).toContain("Includes practical?");
    expect(html).toContain("Only theory marks will be considered for this exam.");
    expect(html).toContain("Both theory and practical marks will be considered for this exam.");
    expect(html).toMatch(/type="radio"[^>]*checked=""[^>]*\/><span[^>]*>Theory only</);
  });

  it("shows what is left from the exams already in the pattern, and holds the button until it is valid", () => {
    const html = inContext(<ExamForm exams={two} onDone={() => {}} />);
    expect(html).toContain("Total weight of all exams must equal 100%.");
    expect(html).toContain("Current total: 60%");
    expect(html).toContain("Remaining: 40%");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Add exam</);
  });

  it("changing an exam leaves its own weight out of the total", () => {
    const html = inContext(<ExamForm exams={three} editing={2} onDone={() => {}} />);
    expect(html).toContain("Current total: 60%");
    expect(html).toContain("Remaining after this exam: 0%"); // its own 40 is typed in, so it fills what is left
    expect(html).toContain("Change this exam in the term&#x27;s pattern.");
    expect(html).toContain(">Save exam<");
  });

  it("stops offering Add once the pattern holds as many exams as it may", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => exam(`E${i}`, 1));
    const html = inContext(<AddExamDialog exams={twelve} label="Add exam" onAdd={() => {}} />);
    expect(html).toContain("A pattern can have at most 12 exams.");
    expect(html).not.toContain("<dialog");
  });
});

describe("the pattern's settings", () => {
  const draft = draftFrom(saved());
  const props = { term: "School 2025-26", saving: false, problem: null, onClose: () => {}, onApply: () => {} };

  it("keeps the grade system and the pass minimums here, with the explanation, and the exams under them", () => {
    const html = inContext(<PatternPanel {...props} draft={draft} editable={{ editable: true }} />);
    expect(html).toContain("Pattern settings");
    expect(html).toContain("Grade system?");
    expect(html).toContain("Minimum marks to pass");
    expect(html).toContain("Theory: minimum % to pass");
    expect(html).toContain("Practical: minimum % to pass");
    expect(html).toContain("The practical minimum applies only to exams that include practical marks.");
    expect(html).toContain("Exam components");
    expect(html).toContain("Total: 100%");
    expect(html).toContain(">Cancel<");
    expect(html).toContain(">Save exam pattern<");
  });

  it("while the exams do not add up to 100 it cannot save, and says so; settings are kept for later", () => {
    const html = inContext(<PatternPanel {...props} draft={{ ...draft, exams: draft.exams.slice(0, 2) }} editable={{ editable: true }} />);
    expect(html).toContain("The exams add up to 60%. They must add up to exactly 100% before the pattern can be saved.");
    expect(html).toContain(">Keep these settings<");
    expect(html).not.toContain(">Save exam pattern<");
  });

  it("when marks are in, it is only read, and says why", () => {
    const html = inContext(<PatternPanel {...props} draft={draft} editable={{ editable: false, why: "locked" }} />);
    expect(html).toContain("Marks have been entered in this term, so its exam pattern can no longer change.");
    expect(html).toContain("No: percentage");
    expect(html).not.toContain(">Save exam pattern<");
    expect(html).not.toContain("<input");
  });
});

describe("the whole board", () => {
  const board = (pattern: ExamPattern, canManage = true) => inContext(<PatternBoard saved={pattern} canManage={canManage} onSaved={() => {}} />);

  it("a saved pattern: set for the term, Edit pattern, the three figures, the exams, Add exam and the note", () => {
    const html = board(saved());
    expect(html).toContain("Exam pattern is set for this term");
    expect(html).toContain(">Edit pattern<");
    expect(html).toContain("Pattern overview");
    expect(html).toContain("Exam components");
    expect(html).toContain(">Add exam<");
    expect(html).toContain(">Important<");
    expect(html).toContain("If a class needs a different pattern, create a separate academic term for that class.");
  });

  it("a locked pattern says View pattern, lets nothing be added or changed, and shows the lock", () => {
    const html = board(saved({ locked: true }));
    expect(html).toContain(">View pattern<");
    expect(html).not.toContain(">Edit pattern<");
    expect(html).not.toContain(">Add exam<");
    expect(html).not.toContain("Actions for");
    expect(html).toContain(">Locked<");
  });

  it("a closed term and someone who may only look are read-only too", () => {
    for (const html of [board(saved({ term: { id: "y", label: "x", status: "closed" } })), board(saved(), false)]) {
      expect(html).toContain(">View pattern<");
      expect(html).not.toContain(">Add exam<");
    }
  });

  it("a term with no exams shows the empty state and Add first exam", () => {
    const html = board(empty());
    expect(html).toContain("No exams added yet");
    expect(html).toContain("Create the exam structure for this academic term. The total exam weight must add up to 100%.");
    expect(html).toContain(">Add first exam<");
    expect(html).not.toContain("Exam pattern is set");
    expect(html).not.toContain("Exam pattern is incomplete");
  });

  it("a reader of an empty term is told who makes it, and is offered nothing to add", () => {
    const html = board(empty(), false);
    expect(html).toContain("No exams added yet");
    expect(html).toContain("The Vice Principal makes it here.");
    expect(html).not.toContain("Add first exam");
  });
});
