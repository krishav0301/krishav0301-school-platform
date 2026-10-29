import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { GiveRollsDialog, givenText } from "@/classes/GiveRollsDialog";
import { StudentsTable } from "@/classes/ClassesScreen";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/classes/class", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

/** Roll numbers (the PM, 2026-10-29): the Co-ordinator's one click on a class's Students tab. */
const session = fakeSession({ status: "signedIn", me: { id: "u", name: "Asha", roles: [{ role: "coordinator", scope: "institution" }] } });

describe("the Give roll numbers button", () => {
  it("is a quiet button on the Students tab, named for what it does", () => {
    const html = renderToStaticMarkup(
      <SessionContext.Provider value={session}>
        <GiveRollsDialog classId="c1" waiting={3} onGiven={() => undefined} />
      </SessionContext.Provider>,
    );
    expect(html).toContain("Give roll numbers");
  });

  it("tells the Co-ordinator what came of the click, in words", () => {
    expect(givenText({ ok: true, numbered: 34 })).toBe("Roll numbers given to 34 students.");
    expect(givenText({ ok: true, numbered: 1 })).toBe("A roll number given to 1 student.");
    expect(givenText({ ok: false, reason: "nobody_waiting" })).toBe("Everyone in this class already has a roll number.");
    expect(givenText({ ok: false, reason: "failed" })).toBe("The roll numbers could not be given. Try again.");
  });
});

describe("the students of a class before and after numbering", () => {
  const hub = (rolls: (number | null)[]) => ({
    viewer: { seesAll: true, attendance: true, isClassTeacher: false, staff: true },
    students: rolls.map((rollNo, i) => ({ enrollmentId: `e${i}`, rollNo, name: `Student ${i}`, sid: `2083-0000${i}`, studentId: `s${i}` })),
  });

  it("shows a dash for a student with no roll number yet, and the number once given", () => {
    const html = renderToStaticMarkup(<StudentsTable hub={hub([1, null])} canOpenRecord={false} />);
    expect(html).toContain(">1<");
    expect(html).toContain("—");
  });
});
