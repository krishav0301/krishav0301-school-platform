import { afterEach, describe, expect, it } from "vitest";

import { makeConfigValue } from "@/config/ConfigProvider";
import { DEFAULT_SCHOOL_WORDS, setSchoolWords, t } from "@/i18n/messages";

// D-114: messages fill in the school's own words, so a raw "{programme}" never reaches a screen.
describe("the school's words in messages", () => {
  afterEach(() => setSchoolWords({}));

  it("uses Wing, Course, Level and Section by default", () => {
    expect(DEFAULT_SCHOOL_WORDS).toEqual({ section: "Wing", programme: "Course", level: "Level", classSection: "Section", terminal: "Exam" });
    expect(t("access.allSections")).toBe("All Wings");
    expect(t("dashboard.actions.programme")).toBe("Add Course");
    expect(t("setup.classes.label")).toBe("Section (optional)");
  });

  it("follows the school's renamed words once its config is known", () => {
    makeConfigValue("ready", { terms: { "term.section": "Stream", "term.programme": "Programme", "term.classSection": "Group" } } as never);
    expect(t("access.allSections")).toBe("All Streams");
    expect(t("access.allProgrammes")).toBe("All Programmes");
    expect(t("setup.classes.label")).toBe("Group (optional)");
    expect(t("people.homeSection")).toBe("Home Stream");
  });

  it("lets a caller's own value win", () => {
    expect(t("dashboard.actions.programme", { programme: "Stream" })).toBe("Add Stream");
  });

  it("leaves every other placeholder alone", () => {
    expect(t("terms.form.takenBy", {})).toContain("{term}");
  });

});
