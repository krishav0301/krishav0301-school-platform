import { describe, expect, it } from "vitest";

import { t } from "@/i18n/messages";
import { SITE_LINKS } from "@/shell/site-links";
import { FILLED_PAGES } from "../../api/src/modules/site";

describe("the links to the public pages", () => {
  it("are the pages the Worker fills in, except Home (the school's name is that link), in reading order", () => {
    expect(SITE_LINKS.map((l) => l.href)).toEqual(["/programmes", "/admission", "/scholarships", "/facilities", "/contact", "/notices"]);
    expect(SITE_LINKS.map((l) => l.href).sort()).toEqual(FILLED_PAGES.filter((p) => p !== "/").sort());
  });

  it("each has a label from the catalog", () => {
    expect(SITE_LINKS.map((l) => t(l.labelKey))).toEqual(["Programmes", "Admission", "Scholarships", "Facilities", "Contact", "Notices and updates"]);
  });
});
