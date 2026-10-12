import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ImportResults, ImportRunning } from "@/classes/ImportStudents";
import { ImportJobContext, jobReducer, mergeResults, type ImportJob, type ImportJobValue } from "@/classes/import-job";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { ImportChip, chipView } from "@/shell/ImportChip";
import type { RowResult } from "@/sheets/student-import";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

// The class import beside the page (the PM, 2026-10-12): it keeps running when its window is closed, shows as a chip in the
// top bar with its progress, and the window opens again where it was.

const start = { classId: "c8", levelId: "l8", className: "General · Class 8 · Section A", rows: [], total: 40, results: null };
const admitted = (line: number): RowResult => ({ line, name: `Student ${line}`, status: "admitted", sid: `2083-${String(line).padStart(5, "0")}`, email: `s${line}@student.com`, password: "1234" });

describe("the import job's state", () => {
  it("starts empty-handed and running, counts up, waits, and finishes with everything it came to", () => {
    let job = jobReducer(null, { type: "start", job: start });
    expect(job).toMatchObject({ running: true, done: 0, total: 40, live: [], waiting: null });
    job = jobReducer(job, { type: "progress", done: 20, total: 40 });
    job = jobReducer(job, { type: "result", result: admitted(2) });
    job = jobReducer(job, { type: "wait", waiting: { attempt: 2, of: 8 } });
    expect(job).toMatchObject({ done: 20, waiting: { attempt: 2, of: 8 } });
    expect(job!.live).toHaveLength(1);
    job = jobReducer(job, { type: "progress", done: 21, total: 40 });
    expect(job!.waiting).toBeNull(); // the next student means the wait is over
    job = jobReducer(job, { type: "finish", results: [admitted(2)] });
    expect(job).toMatchObject({ running: false, done: 40, results: [admitted(2)] });
    expect(jobReducer(job, { type: "dismiss" })).toBeNull();
  });

  it("changes nothing when there is no job to change", () => {
    expect(jobReducer(null, { type: "progress", done: 1, total: 2 })).toBeNull();
    expect(jobReducer(null, { type: "finish", results: [] })).toBeNull();
  });

  it("lays a second pass over the first, in the order of the sheet", () => {
    const dup: RowResult = { line: 3, name: "Ankush Rai", status: "duplicate", matches: [] };
    const first = [admitted(2), dup, admitted(4)];
    expect(mergeResults(first, [admitted(3)]).map((r) => [r.line, r.status])).toEqual([[2, "admitted"], [3, "admitted"], [4, "admitted"]]);
    expect(mergeResults(null, [admitted(5), admitted(2)]).map((r) => r.line)).toEqual([2, 5]);
  });
});

const running: ImportJob = { ...start, rows: [], total: 40, done: 20, waiting: null, live: [admitted(2)], results: null, running: true };
const finished: ImportJob = { ...running, done: 40, running: false, results: [admitted(2)] };
const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: { fees: true, homework: true, results: true },
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
};
const withJob = (job: ImportJob | null, element: React.ReactNode) => {
  const value: ImportJobValue = { job, start: () => true, dismiss: () => {}, finished: 0 };
  return renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <ImportJobContext.Provider value={value}>{element}</ImportJobContext.Provider>
    </ConfigContext.Provider>,
  );
};

describe("the chip in the top bar", () => {
  it("is not there without an import", () => {
    expect(withJob(null, <ImportChip />)).toBe("");
  });

  it("shows the class and how far it is, while it runs, with a bar", () => {
    const html = withJob(running, <ImportChip />);
    expect(html).toContain("Adding students to General · Class 8 · Section A: 20 of 40");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="20"');
    expect(html).toContain("scaleX(0.5)");
    expect(html).toContain('aria-label="Open the student import for General · Class 8 · Section A"');
  });

  it("stays after it ends, full, until the results are closed", () => {
    expect(chipView(finished)).toEqual({ text: "Import for General · Class 8 · Section A is done. Open it", share: 1 });
    expect(withJob(finished, <ImportChip />)).toContain("scaleX(1)");
  });
});

describe("the import window while it runs and when it is done", () => {
  it("while it runs: says it can be closed, shows the bar, the wait and the sheet so far", () => {
    const html = withJob({ ...running, waiting: { attempt: 2, of: 8 } }, <ImportRunning job={{ ...running, waiting: { attempt: 2, of: 8 } }} />);
    expect(html).toContain("You can close this window");
    expect(html).toContain("20 of 40 students done");
    expect(html).toContain("The server is busy. Waiting a moment, then trying again (try 2 of 8)");
    expect(html).toContain("Download the sign-in sheet so far");
  });

  it("when done: the count, the sheet, and a Done button to close the results", () => {
    const html = withJob(finished, <ImportResults job={finished} results={finished.results!} onAdmitAnyway={() => {}} onDone={() => {}} />);
    expect(html).toContain("1 students admitted to General · Class 8 · Section A.");
    expect(html).toContain("Download the sign-in sheet");
    expect(html).toContain(">Done<");
  });
});
