import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SortSelect } from "@/people/SortSelect";
import { sortStudents } from "@/people/student-sort";

const rows = [
  { name: "Sita Rai", sid: "2083-00003", rollNo: 2, rank: 2 },
  { name: "anil Shrestha", sid: "2083-00001", rollNo: null, rank: null },
  { name: "Bina Thapa", sid: "2083-00002", rollNo: 1, rank: 1 },
  { name: "Bina Thapa", sid: "2083-00010", rollNo: 3, rank: null },
];
const names = (s: Parameters<typeof sortStudents>[1]) =>
  sortStudents(rows, s).map((r) => r.sid);

describe("sortStudents", () => {
  it("roll number puts students with none last", () =>
    expect(names("roll")).toEqual([
      "2083-00002",
      "2083-00003",
      "2083-00010",
      "2083-00001",
    ]));
  it("name A to Z ignores case and breaks a tie by SID", () =>
    expect(names("name")).toEqual([
      "2083-00001",
      "2083-00002",
      "2083-00010",
      "2083-00003",
    ]));
  it("name Z to A is the reverse by name", () =>
    expect(names("nameDesc")).toEqual([
      "2083-00003",
      "2083-00002",
      "2083-00010",
      "2083-00001",
    ]));
  it("SID sorts as numbers within text", () =>
    expect(names("sid")).toEqual([
      "2083-00001",
      "2083-00002",
      "2083-00003",
      "2083-00010",
    ]));
  it("rank puts the unranked last", () =>
    expect(names("rank")).toEqual([
      "2083-00002",
      "2083-00003",
      "2083-00001",
      "2083-00010",
    ]));
  it("server keeps the order given, and never changes the input", () => {
    const copy = [...rows];
    expect(sortStudents(rows, "server")).toEqual(rows);
    sortStudents(rows, "name");
    expect(rows).toEqual(copy);
  });
});

describe("SortSelect", () => {
  it("offers only the orders it is given, under a label", () => {
    const html = renderToStaticMarkup(
      <SortSelect value="name" onChange={() => {}} options={["name", "sid"]} />,
    );
    expect(html).toContain("Sort by");
    expect(html).toContain("Name, A to Z");
    expect(html).toContain("Student ID");
    expect(html).not.toContain("Rank");
  });
});
