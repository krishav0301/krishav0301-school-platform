import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseCsv, toCsv } from "@/sheets/csv";
import { cellText, toTable } from "@/sheets/table";
import { STUDENT_COLUMNS, firstProblem, loginsCsv, normaliseBsDate, parseStudentSheet, studentTemplateCsv } from "@/sheets/student-import";

// Excel sheets, class by class (the PM, 2026-10-11): reading what Excel saves, and what the Co-ordinator's class list becomes.

describe("CSV, as Excel saves and opens it", () => {
  it("reads quotes, a quote written twice, commas and line breaks inside quotes, and any line ending", () => {
    expect(parseCsv('a,b,c\r\n1,"x, y","say ""hi"""\n"two\nlines",,3\r4,5,6')).toEqual([
      ["a", "b", "c"],
      ["1", "x, y", 'say "hi"'],
      ["two\nlines", "", "3"],
      ["4", "5", "6"],
    ]);
  });

  it("drops a byte-order mark and the rows with nothing in them, and reads a semicolon-separated sheet (Excel in some regions)", () => {
    expect(parseCsv("﻿Name;Phone\n\n;;\nSita;98\n")).toEqual([["Name", "Phone"], ["Sita", "98"]]);
  });

  it("writes what it reads: a round trip, with a byte-order mark so Excel shows Nepali letters", () => {
    const rows = [["Name", "Note"], ["सीता", 'a, "b"'], ["Ram", ""]];
    const text = toCsv(rows);
    expect(text.startsWith("﻿")).toBe(true);
    expect(parseCsv(text)).toEqual(rows);
  });

  it("never lets a cell run as a formula, but keeps a number as a number", () => {
    const text = toCsv([["=HYPERLINK(1)", "+1 call", "-5", "@x", "12.5", "ok"]]);
    expect(text).toContain('"\'=HYPERLINK(1)"');
    expect(text).toContain('"\'+1 call"');
    expect(text).toContain('"-5"');
    expect(text).toContain('"\'@x"');
    expect(text).toContain('"12.5"');
  });
});

describe("a sheet's cells as text", () => {
  it("a date is the day as typed (a Nepali date Excel took for a date), a number is its digits, an empty cell is nothing", () => {
    expect(cellText(new Date(Date.UTC(2065, 0, 19)))).toBe("2065-01-19");
    expect(cellText(9801234567)).toBe("9801234567");
    expect(cellText("  Sita ")).toBe("Sita");
    expect(cellText(null)).toBe("");
    expect(cellText(undefined)).toBe("");
    expect(cellText(true)).toBe("");
  });

  it("rows with nothing in them are not rows", () => {
    expect(toTable([["a", null], [null, ""], ["", "b"]])).toEqual([["a", ""], ["", "b"]]);
  });

  it("reads a real .xlsx file the way a person sees it", async () => {
    const { readSheet } = await import("read-excel-file/node");
    const rows = toTable((await readSheet(fileURLToPath(new URL("./fixtures/class-list.xlsx", import.meta.url)))) as never);
    expect(rows).toEqual([
      ["First name", "Last name", "Date of birth (BS)", "Phone"],
      ["Sita", "Rai", "2065-01-19", "9801234567"],
      ["Hari", "Karki", "", ""],
    ]);
    expect(readFileSync(new URL("./fixtures/class-list.xlsx", import.meta.url)).length).toBeGreaterThan(100);
  });
});

describe("a class list from a sheet", () => {
  const level = "level-1";

  it("the template has every column, in order, and one example row that is itself a valid student", () => {
    const rows = parseCsv(studentTemplateCsv());
    expect(rows[0]).toEqual(STUDENT_COLUMNS.map((c) => c.header));
    const parsed = parseStudentSheet(rows, level);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.rows.map((r) => firstProblem(r))).toEqual([null]);
  });

  it("only the first name is needed: every other column may be left out of the sheet or empty in a row", () => {
    const parsed = parseStudentSheet([["First name"], ["Sita"], ["Hari"]], level);
    expect(parsed).toMatchObject({ ok: true, ignored: [] });
    if (!parsed.ok) return;
    expect(parsed.rows.map((r) => [r.line, r.values.firstName, r.values.levelId, firstProblem(r)])).toEqual([[2, "Sita", level, null], [3, "Hari", level, null]]);
  });

  it("finds the header row below a title, understands the usual names for a column, and says which columns it ignored", () => {
    const parsed = parseStudentSheet(
      [["Grade 11 Morning"], ["Student Name", "Surname", "DOB", "Mobile", "Father's name", "Blood group"], ["Sita", "Rai", "2065/1/9", "9801234567", "Ram Rai", "O+"]],
      level,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.ignored).toEqual(["Blood group"]);
    expect(parsed.rows[0]!.values).toMatchObject({ firstName: "Sita", lastName: "Rai", dobBs: "2065-01-09", phone: "9801234567", guardianName: "Ram Rai" });
    expect(parsed.rows[0]!.line).toBe(3);
    expect(firstProblem(parsed.rows[0]!)).toBeNull();
  });

  it("checks what is given the way the quick form does, and points at the row", () => {
    const parsed = parseStudentSheet([["First name", "Phone", "Email", "Date of birth"], ["", "98", "nope", "19 Baisakh"], ["Ok", "", "", ""]], level);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0]!.errors).toMatchObject({ firstName: "admissions.error.required", phone: "admissions.error.phone", email: "admissions.error.email", dobBs: "admissions.error.dobInvalid" });
    expect(firstProblem(parsed.rows[0]!)).toBe("admissions.error.required");
    expect(firstProblem(parsed.rows[1]!)).toBeNull();
    expect(parsed.rows[0]!.line).toBe(2);
  });

  it("says what is wrong with the sheet itself: no name column, no students, too many", () => {
    expect(parseStudentSheet([["Phone"], ["98"]], level)).toEqual({ ok: false, reason: "no_name_column" });
    expect(parseStudentSheet([["First name"], [""]], level)).toEqual({ ok: false, reason: "no_rows" });
    expect(parseStudentSheet([["First name"], ...Array.from({ length: 301 }, (_, i) => [`S${i}`])], level)).toEqual({ ok: false, reason: "too_many" });
  });

  it("a Nepali date is accepted in the usual shapes and nothing else", () => {
    expect(normaliseBsDate("2065-1-9")).toBe("2065-01-09");
    expect(normaliseBsDate("2065.01.19")).toBe("2065-01-19");
    expect(normaliseBsDate("65-1-9")).toBeNull();
    expect(normaliseBsDate("")).toBeNull();
  });

  it("the sign-in sheet lists only the students who were admitted", () => {
    const text = loginsCsv([
      { line: 2, name: "Sita Rai", status: "admitted", sid: "2083-00001", email: "sita@student.com", password: "4821" },
      { line: 3, name: "Hari", status: "problem", message: "x" },
      { line: 4, name: "Gita", status: "duplicate", matches: [] },
    ]);
    expect(parseCsv(text)).toEqual([["Student ID", "Name", "Sign-in email", "Temporary password"], ["2083-00001", "Sita Rai", "sita@student.com", "4821"]]);
  });
});

// ---------------------------------------------------------------------------------------------
import { marksTemplateCsv, parseMarksSheet } from "@/sheets/marks-import";
import { markKey, type MarkSheet } from "@/results/model";

describe("a subject's marks from a sheet", () => {
  const sheet = {
    components: [
      { id: "theory", maxHundredths: 7500 },
      { id: "practical", maxHundredths: 2500 },
    ],
    students: [
      { enrollmentId: "e1", sid: "2083-00001", name: "Sita Rai", marks: [{ componentId: "theory", valueHundredths: 6250, absent: false }] },
      { enrollmentId: "e2", sid: "2083-00002", name: "Hari Karki", marks: [] },
      { enrollmentId: "e3", sid: "2083-00003", name: "Gita Thapa", marks: [] },
    ],
  } as unknown as MarkSheet;

  it("the template lists the class by student ID and name, each part out of its maximum, with marks already entered", () => {
    const rows = parseCsv(marksTemplateCsv(sheet));
    expect(rows[0]).toEqual(["Student ID", "Name", "Theory (out of 75)", "Practical (out of 25)"]);
    expect(rows[1]).toEqual(["2083-00001", "Sita Rai", "62.5", ""]);
    expect(rows).toHaveLength(4);
  });

  it("fills the grid by student ID, whatever the order of the rows, and skips empty cells", () => {
    const parsed = parseMarksSheet(
      [["Student ID", "Name", "Theory (out of 75)", "Practical (out of 25)"], ["2083-00002", "x", "70", "20.5"], ["2083-00001", "y", "AB", ""]],
      sheet,
    );
    expect(parsed).toMatchObject({ ok: true, filled: 2, notFound: [], problems: [], missingRows: 1 });
    if (!parsed.ok) return;
    expect(parsed.draft).toEqual({ [markKey("e2", "theory")]: "70", [markKey("e2", "practical")]: "20.5", [markKey("e1", "theory")]: "AB" });
  });

  it("reports an ID that is not in the class, a mark that is not a mark, and one over the maximum, and puts none of them in the grid", () => {
    const parsed = parseMarksSheet(
      [["sid", "Theory", "Practical"], ["2083-99999", "50", "10"], ["2083-00001", "seventy", "26"], ["2083-00003", "75", "25"]],
      sheet,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.notFound).toEqual(["2083-99999"]);
    expect(parsed.problems).toEqual([
      { sid: "2083-00001", name: "Sita Rai", part: "Theory", text: "seventy", reason: "not_a_mark" },
      { sid: "2083-00001", name: "Sita Rai", part: "Practical", text: "26", reason: "over_max" },
    ]);
    expect(parsed.draft).toEqual({ [markKey("e3", "theory")]: "75", [markKey("e3", "practical")]: "25" });
    expect(parsed.filled).toBe(1);
  });

  it("a sheet with only a theory column fills the theory part and leaves the practical alone", () => {
    const parsed = parseMarksSheet([["Student ID", "Theory (out of 75)"], ["2083-00002", "50"]], sheet);
    expect(parsed.ok && parsed.draft).toEqual({ [markKey("e2", "theory")]: "50" });
  });

  it("a mark typed with a leading zero, or read as a number from Excel, comes out as a mark", () => {
    const parsed = parseMarksSheet([["Student ID", "Theory"], ["2083-00002", "07.5"], ["2083-00003", "60"]], sheet);
    expect(parsed.ok && parsed.draft).toEqual({ [markKey("e2", "theory")]: "7.5", [markKey("e3", "theory")]: "60" });
  });

  it("says what is wrong with the sheet itself: no ID column, no mark column, no rows", () => {
    expect(parseMarksSheet([["Name", "Theory"], ["x", "1"]], sheet)).toEqual({ ok: false, reason: "no_id_column" });
    expect(parseMarksSheet([["Student ID", "Name"], ["2083-00001", "x"]], sheet)).toEqual({ ok: false, reason: "no_mark_columns" });
    expect(parseMarksSheet([["Student ID", "Theory"]], sheet)).toEqual({ ok: false, reason: "no_rows" });
  });
});

// ---------------------------------------------------------------------------------------------
import { renderToStaticMarkup } from "react-dom/server";
import { MarksExcel, importWords } from "@/results/MarksExcel";

describe("what the teacher is told after an upload", () => {
  it("a clean upload says how many students' marks are in the boxes, and that nothing is saved yet", () => {
    const said = importWords({ ok: true, draft: {}, filled: 38, notFound: [], missingRows: 0, problems: [] });
    expect(said.tone).toBe("ok");
    expect(said.lines).toEqual(["Marks for 38 students are in the boxes below. Check them, then save."]);
  });

  it("names the IDs not in the class, each bad mark with who and what, and the students with no row", () => {
    const said = importWords({
      ok: true,
      draft: {},
      filled: 2,
      notFound: ["2083-99999"],
      missingRows: 3,
      problems: [
        { sid: "2083-00001", name: "Sita Rai", part: "Theory", text: "seventy", reason: "not_a_mark" },
        { sid: "2083-00002", name: "Hari Karki", part: "Practical", text: "26", reason: "over_max" },
      ],
    });
    expect(said.tone).toBe("bad");
    expect(said.lines.join("\n")).toContain("1 student IDs in the sheet are not in this class: 2083-99999");
    expect(said.lines.join("\n")).toContain('Sita Rai (2083-00001), Theory: "seventy" is not a mark.');
    expect(said.lines.join("\n")).toContain('Hari Karki (2083-00002), Practical: "26" is more than the most it can be.');
    expect(said.lines.join("\n")).toContain("3 students of the class have no row in the sheet.");
  });

  it("a sheet with no marks in it says so", () => {
    expect(importWords({ ok: true, draft: {}, filled: 0, notFound: [], missingRows: 0, problems: [] })).toEqual({ tone: "bad", lines: ["No marks were found in that sheet."] });
  });

  it("the grid has a download and an upload, and the upload takes Excel and CSV", () => {
    const html = renderToStaticMarkup(<MarksExcel sheet={{ subjectName: "Maths", terminal: { id: "t", name: "First" }, components: [], students: [] } as never} onFill={() => {}} />);
    expect(html).toContain("Download the sheet");
    expect(html).toContain("Upload marks from Excel");
    expect(html).toContain('accept=".xlsx,.csv');
  });
});

// ---------------------------------------------------------------------------------------------
import { admitRows, type AdmitDeps } from "@/sheets/admit-rows";

describe("admitting a class list", () => {
  const rowsOf = (table: string[][]) => {
    const parsed = parseStudentSheet(table, "level-1");
    if (!parsed.ok) throw new Error("sheet");
    return parsed.rows;
  };
  const deps = (over: Partial<AdmitDeps> = {}): AdmitDeps & { sent: { firstName: string; email: string; ad: string; confirm: boolean }[] } => {
    const sent: { firstName: string; email: string; ad: string; confirm: boolean }[] = [];
    let n = 0;
    return {
      sent,
      toAd: async (bs) => (bs === "2065-02-31" ? { ok: false, error: "dateInvalid" } : { ok: true, ad: "2008-05-14" }),
      suggestEmail: async (firstName, lastName) => `${[firstName, lastName].filter(Boolean).join(".").toLowerCase()}@student.com`,
      walkIn: async (values, ad, confirm) => {
        sent.push({ firstName: values.firstName, email: values.email, ad, confirm });
        return { ok: true, sid: `2083-${String(++n).padStart(5, "0")}`, temporaryPassword: "4821" };
      },
      ...over,
    };
  };

  it("admits each row in the order of the sheet with its own sign-in email, and gives the sign-in sheet's rows", async () => {
    const d = deps();
    const results = await admitRows(d, rowsOf([["First name", "Last name", "Date of birth"], ["Sita", "Rai", "2065-01-19"], ["Hari", "", ""]]));
    expect(results.map((r) => [r.status, r.name])).toEqual([["admitted", "Sita Rai"], ["admitted", "Hari"]]);
    expect(d.sent).toEqual([
      { firstName: "Sita", email: "sita.rai@student.com", ad: "2008-05-14", confirm: false },
      { firstName: "Hari", email: "hari@student.com", ad: "", confirm: false },
    ]);
    expect(parseCsv(loginsCsv(results))[1]).toEqual(["2083-00001", "Sita Rai", "sita.rai@student.com", "4821"]);
  });

  it("keeps an email that was in the sheet, and does not ask for one", async () => {
    const d = deps({ suggestEmail: async () => { throw new Error("not asked"); } });
    await admitRows(d, rowsOf([["First name", "Email"], ["Sita", "sita.rai@example.com"]]));
    expect(d.sent[0]!.email).toBe("sita.rai@example.com");
  });

  it("does not send a row that has a problem in the sheet, or a date that is not a day, and says why; the other rows still go", async () => {
    const d = deps();
    const results = await admitRows(d, rowsOf([["First name", "Phone", "Date of birth"], ["", "98", ""], ["Bad", "", "2065-02-31"], ["Good", "", ""]]));
    expect(results.map((r) => r.status)).toEqual(["problem", "problem", "admitted"]);
    expect(d.sent.map((s) => s.firstName)).toEqual(["Good"]);
    expect(results[1]).toMatchObject({ message: "That is not a valid date." });
  });

  it("a possible duplicate is reported, not admitted, unless the person says to admit them anyway", async () => {
    const asked: boolean[] = [];
    const d = deps({
      walkIn: async (_values, _ad, confirm) => {
        asked.push(confirm);
        return confirm ? { ok: true, sid: "2083-00009", temporaryPassword: "1111" } : { ok: false, reason: "duplicate", matches: [{ name: "Sita Rai", sid: "2083-00001" }] };
      },
    });
    const rows = rowsOf([["First name"], ["Sita"]]);
    const first = await admitRows(d, rows);
    expect(first[0]).toMatchObject({ status: "duplicate", matches: [{ sid: "2083-00001" }] });
    const again = await admitRows(d, rows, { confirmDuplicate: true });
    expect(again[0]).toMatchObject({ status: "admitted", sid: "2083-00009" });
    expect(asked).toEqual([false, true]);
  });

  it("a refusal from the server is said in words for that row and does not stop the rest; progress is reported", async () => {
    let calls = 0;
    const progress: number[] = [];
    const d = deps({
      walkIn: async () => (++calls === 1 ? { ok: false, reason: "invalid", message: "Pick a class that is open." } : { ok: true, sid: "2083-00002", temporaryPassword: "2222" }),
    });
    const results = await admitRows(d, rowsOf([["First name"], ["A"], ["B"]]), { onProgress: (done) => progress.push(done) });
    expect(results.map((r) => r.status)).toEqual(["problem", "admitted"]);
    expect(results[0]).toMatchObject({ message: "Pick a class that is open." });
    expect(progress).toEqual([0, 1, 2]);
  });
});

// ---------------------------------------------------------------------------------------------
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { ImportStudents, tally } from "@/classes/ImportStudents";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";

describe("the import dialog", () => {
  const config = { school: { name: "S", shortName: "S", currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null }, sections: [], modules: {}, terms: {}, theme: {} } as unknown as PublicConfig;

  it("opens on what it will do, the template, the file, and no preview yet", () => {
    const html = renderToStaticMarkup(
      <ConfigContext.Provider value={makeConfigValue("ready", config)}>
        <SessionContext.Provider value={fakeSession({ status: "signedIn", me: { id: "user-1", name: "Asha", roles: [{ role: "coordinator", scope: "institution" }] } })}>
          <ImportStudents classId="c1" levelId="l1" className="Science · Grade 11" onDone={() => {}} />
        </SessionContext.Provider>
      </ConfigContext.Provider>,
    );
    expect(html).toContain("Add the students of Science · Grade 11 from an Excel sheet.");
    expect(html).toContain("Only the first name is needed");
    expect(html).toContain("Download the template");
    expect(html).toContain("Choose the file");
    expect(html).not.toContain("ready to admit");
  });

  it("counts what came of each row", () => {
    expect(
      tally([
        { line: 2, name: "A", status: "admitted", sid: "1", email: "a@student.com", password: "1234" },
        { line: 3, name: "B", status: "duplicate", matches: [] },
        { line: 4, name: "C", status: "problem", message: "x" },
        { line: 5, name: "D", status: "problem", message: "y" },
      ]),
    ).toEqual({ admitted: 1, duplicates: 1, problems: 2 });
  });
});
