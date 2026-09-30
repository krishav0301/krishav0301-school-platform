import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ActivityEditor } from "@/classwork/ActivityEditor";
import { ActivityScreen, DayList } from "@/classwork/ActivityScreen";
import { ClassworkTabs } from "@/classwork/ClassworkTabs";
import { StudentAssignment } from "@/classwork/HomeworkScreen";
import { ProtectedNotes } from "@/classwork/NotesScreen";
import { className, dueInstant, nepalTime, type StudentAssignments } from "@/classwork/model";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/classwork", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: royal.sections,
  modules: { notes: true, homework: true },
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
};
const as = (role: string, scope: "institution" | "own" | "assigned" = "institution") => fakeSession({ status: "signedIn", me: { name: "Asha", roles: [{ role, scope }] } });
const inContext = (element: React.ReactNode, session = as("teacher", "assigned")) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={session}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

const subject = { classId: "c1", offeringId: "o1", subjectName: "Physics", programmeName: "Science", levelName: "Grade 11", label: "", body: null };

describe("the activity log", () => {
  it("names a class with its label only when it has one", () => {
    expect(className({ programmeName: "Science", levelName: "Grade 11", label: "" })).toBe("Science · Grade 11");
    expect(className({ programmeName: "Science", levelName: "Grade 11", label: "Day" })).toBe("Science · Grade 11 · Day");
  });

  it("a subject not written yet says so, with a labelled box and a Save that waits for words", () => {
    const html = inContext(<ActivityEditor subject={subject} />);
    expect(html).toContain("Physics");
    expect(html).toContain("Science · Grade 11");
    expect(html).toContain("Not written yet");
    expect(html).toContain("What the class did today");
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it("a written subject shows its words and no 'not written' label", () => {
    const html = inContext(<ActivityEditor subject={{ ...subject, body: "Chapter 3." }} />);
    expect(html).toContain("Chapter 3.");
    expect(html).not.toContain("Not written yet");
  });

  it("a student's days list each subject's entry under its day, newest first as given", () => {
    const html = inContext(
      <DayList
        days={[
          { date: "2026-09-28", dateBs: "2083-06-12", entries: [{ subjectName: "Physics", teacherName: "Ram", body: "Motion." }] },
          { date: "2026-09-27", dateBs: "2083-06-11", entries: [{ subjectName: "English", teacherName: "Gita", body: "Poem." }] },
        ]}
      />,
      as("student", "own"),
    );
    expect(html.indexOf("2083-06-12")).toBeLessThan(html.indexOf("2083-06-11"));
    expect(html).toContain("Motion.");
  });

  it("each role's view shows the shape of the page while it loads", () => {
    for (const session of [as("teacher", "assigned"), as("student", "own"), as("coordinator")]) {
      expect(inContext(<ActivityScreen />, session)).toMatch(/role="status"[^>]*aria-busy="true"/);
    }
  });
});

describe("notes", () => {
  const data = {
    watermark: "Sita Sharma · 2083-00001",
    notes: [{ id: "n1", kind: "question_paper" as const, title: "First terminal", body: "Q1. Define velocity.", link: "https://example.org/q.pdf", subjectName: "Physics", teacherName: "Ram", createdAt: "2026-09-28T04:00:00.000Z" }],
  };

  it("draws the student's own name and SID across each note, hidden from screen readers, and says plainly it is for them only", () => {
    const html = inContext(<ProtectedNotes data={data} />, as("student", "own"));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Sita Sharma · 2083-00001");
    expect(html).toContain("please do not copy or share them");
    expect(html).toContain("Question paper");
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("with nothing shared, says so", () => {
    expect(inContext(<ProtectedNotes data={{ watermark: "x", notes: [] }} />, as("student", "own"))).toContain("not shared any notes yet");
  });
});

describe("homework", () => {
  const base: StudentAssignments["assignments"][number] = {
    id: "a1",
    title: "Exercise 3.1",
    instructions: "Solve 1 to 10.",
    link: null,
    dueAt: "2026-09-30T04:15:00.000Z",
    dueDateBs: "2083-06-14",
    maxMarks: 10,
    subjectName: "Physics",
    teacherName: "Ram",
    submission: null,
  };
  const submission = { id: "s1", status: "reviewed" as const, isLate: true, body: "My answers", submittedAt: "2026-09-30T05:00:00.000Z", marks: 8, feedback: "Good.", resubmitReason: null, attempts: 1 };

  it("makes a deadline one Nepal instant, and shows it back in Nepal time", () => {
    expect(new Date(dueInstant("2026-09-30", "10:00")).toISOString()).toBe("2026-09-30T04:15:00.000Z");
    expect(nepalTime("2026-09-30T04:15:00.000Z")).toBe("10:00");
  });

  it("before submitting: the deadline in BS, 'Not submitted', an answer box and Submit", () => {
    const html = inContext(<StudentAssignment assignment={base} onChanged={() => {}} />, as("student", "own"));
    expect(html).toContain("Due 2083-06-14, 10:00");
    expect(html).toContain("Not submitted");
    expect(html).toContain("Your answer");
    expect(html).toContain(">Submit<");
  });

  it("after review: the state, Late, the marks and the feedback, the answer read-only, and a way to ask to resubmit", () => {
    const html = inContext(<StudentAssignment assignment={{ ...base, submission }} onChanged={() => {}} />, as("student", "own"));
    for (const words of ["Reviewed", "Late", "8 of 10", "Good.", "My answers", "Ask to resubmit"]) expect(html).toContain(words);
    expect(html).not.toContain(">Submit<");
  });

  it("once a resubmission is allowed, the answer box comes back", () => {
    const html = inContext(<StudentAssignment assignment={{ ...base, submission: { ...submission, status: "resubmit_allowed" } }} onChanged={() => {}} />, as("student", "own"));
    expect(html).toContain("You may resubmit");
    expect(html).toContain(">Submit<");
  });
});

describe("classwork tabs", () => {
  it("teachers and students get Activity, Notes and Homework; the Co-ordinator has only the activity log, so no tab row", () => {
    const tabs = (role: string, scope: "institution" | "own" | "assigned") => inContext(<ClassworkTabs pathname="/portal/classwork" />, as(role, scope));
    for (const [role, scope] of [["teacher", "assigned"], ["student", "own"]] as const) {
      const html = tabs(role, scope);
      expect(html).toContain("/portal/classwork/notes");
      expect(html).toContain("/portal/classwork/homework");
    }
    expect(tabs("coordinator", "institution")).toBe("");
  });
});
