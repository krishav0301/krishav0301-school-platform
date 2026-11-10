import { describe, expect, it } from "vitest";

import {
  parseDays,
  percentText,
  problemWith,
} from "@/results/TermAttendanceScreen";
import type { TermAttendance } from "@/results/model";

/** The Class Teacher's attendance boxes (the PM, 2026-11-10): what is typed, what the percentage shows, what blocks saving. */
const attendance: TermAttendance = {
  classId: "c",
  programmeName: "School",
  levelName: "Class 9",
  label: "A",
  yearLabel: "2083",
  terminalId: "t",
  terminalName: "Second Terminal",
  workingDays: null,
  locked: false,
  students: [
    {
      enrollmentId: "e1",
      sid: "2083-00001",
      rollNo: 1,
      name: "Anu Mandal",
      daysPresent: null,
    },
    {
      enrollmentId: "e2",
      sid: "2083-00002",
      rollNo: 2,
      name: "Binod Shah",
      daysPresent: null,
    },
  ],
};

describe("typing days", () => {
  it("takes whole numbers only, within the range", () => {
    expect(parseDays("120", 1)).toBe(120);
    expect(parseDays(" 7 ", 0)).toBe(7);
    expect(parseDays("0", 0)).toBe(0);
    expect(parseDays("0", 1)).toBeNull();
    expect(parseDays("367", 0)).toBeNull();
    for (const bad of ["", "-1", "1.5", "1e2", "abc", "12 3", "१२"])
      expect(parseDays(bad, 0), bad).toBeNull();
  });
  it("shows the percentage as the card will: to two places, half up, and nothing for a bad or impossible pair", () => {
    expect(percentText("187", "200")).toBe("93.50");
    expect(percentText("2", "3")).toBe("66.67");
    expect(percentText("200", "200")).toBe("100.00");
    expect(percentText("0", "200")).toBe("0.00");
    expect(percentText("201", "200")).toBe("");
    expect(percentText("", "200")).toBe("");
    expect(percentText("5", "")).toBe("");
  });
});

describe("what blocks saving", () => {
  it("needs working days first", () => {
    expect(problemWith(attendance, { working: "", present: {} })).toMatch(
      /Working days/,
    );
    expect(problemWith(attendance, { working: "0", present: {} })).toMatch(
      /Working days/,
    );
  });
  it("names the student whose days are more than the working days, or not a number", () => {
    expect(
      problemWith(attendance, { working: "100", present: { e1: "101" } }),
    ).toMatch(/Anu Mandal/);
    expect(
      problemWith(attendance, {
        working: "100",
        present: { e1: "5", e2: "x" },
      }),
    ).toMatch(/Binod Shah/);
  });
  it("lets a student be left empty, and a full set be saved", () => {
    expect(
      problemWith(attendance, {
        working: "100",
        present: { e1: "90", e2: "" },
      }),
    ).toBeNull();
    expect(problemWith(attendance, { working: "100", present: {} })).toBeNull();
  });
});
