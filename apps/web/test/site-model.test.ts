import { describe, expect, it } from "vitest";

import { groupProgrammes } from "@/site/model";

const programme = (key: string, section: string) => ({ key, name: key, section, affiliation: "A", duration: "1 year", summary: "S", options: [] as string[] });
const sections = [{ key: "plus2", name: "+2" }, { key: "bachelors", name: "Bachelor's" }];

describe("groupProgrammes", () => {
  it("groups by section, in the section order, keeping each group's own order", () => {
    const groups = groupProgrammes(sections, [programme("b1", "bachelors"), programme("p1", "plus2"), programme("b2", "bachelors")]);
    expect(groups.map((g) => g.name)).toEqual(["+2", "Bachelor's"]);
    expect(groups[1]!.items.map((p) => p.key)).toEqual(["b1", "b2"]);
  });

  it("leaves out a section with nothing in it", () => {
    expect(groupProgrammes(sections, [programme("p1", "plus2")]).map((g) => g.name)).toEqual(["+2"]);
  });

  it("puts a programme in an unknown section last, with no heading, rather than losing it", () => {
    const groups = groupProgrammes(sections, [programme("x", "gone"), programme("p1", "plus2")]);
    expect(groups.map((g) => g.name)).toEqual(["+2", null]);
    expect(groups[1]!.items[0]!.key).toBe("x");
  });
});
