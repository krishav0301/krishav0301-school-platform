import { describe, expect, it } from "vitest";

import { BS_MONTH_NAMES } from "../../api/src/core/dates";
import { en, t } from "@/i18n/messages";
import { KINDS, STATES, emptyForm, firstInvalid, formFromItem, formatBsDate, paragraphs, joinBs, parseEditTarget, parseFlash, splitBs, validateForm, type FormValues } from "@/content/model";

const valid: FormValues = { kind: "notice", title: "Winter break", body: "Closed on Friday.", contact: "", urgent: false, publishOnBs: "2083-06-10", hideAfterBs: "" };
const errorsOf = (over: Partial<FormValues>) => validateForm({ ...valid, ...over });

describe("a new form", () => {
  it("starts as a notice, with today's Nepali date as the start day and nothing else filled in", () => {
    expect(emptyForm("2083-06-05")).toEqual({ kind: "notice", title: "", body: "", contact: "", urgent: false, publishOnBs: "2083-06-05", hideAfterBs: "" });
  });

  it("starts with an empty start day when today's date is not known (past the verified years)", () => {
    expect(emptyForm(null).publishOnBs).toBe("");
  });
});

describe("a form for an existing item", () => {
  it("carries the words and the Nepali days, with blanks instead of nulls", () => {
    const item = { kind: "vacancy", title: "Teacher", body: "Maths", contact: "jobs@school.example", urgent: true, publishOnBs: "2083-01-05", hideAfterBs: null } as never;
    expect(formFromItem(item)).toEqual({ kind: "vacancy", title: "Teacher", body: "Maths", contact: "jobs@school.example", urgent: true, publishOnBs: "2083-01-05", hideAfterBs: "" });
  });

  it("a day beyond the verified years shows as blank, so it must be entered again", () => {
    expect(formFromItem({ kind: "notice", title: "x", body: "y", contact: null, urgent: false, publishOnBs: null, hideAfterBs: null } as never).publishOnBs).toBe("");
  });
});

describe("validateForm", () => {
  it("accepts a complete notice", () => {
    expect(errorsOf({})).toEqual({});
  });

  it("wants a title and some text, ignoring blanks, and names the limits", () => {
    expect(errorsOf({ title: "   " }).title).toBe("contentForm.error.titleRequired");
    expect(errorsOf({ title: "x".repeat(201) }).title).toBe("contentForm.error.titleTooLong");
    expect(errorsOf({ title: "x".repeat(200) }).title).toBeUndefined();
    expect(errorsOf({ body: "" }).body).toBe("contentForm.error.bodyRequired");
    expect(errorsOf({ body: "x".repeat(10_001) }).body).toBe("contentForm.error.bodyTooLong");
    expect(errorsOf({ body: "x".repeat(10_000) }).body).toBeUndefined();
  });

  it("a vacancy needs a contact; other kinds do not, and their contact is not checked", () => {
    expect(errorsOf({ kind: "vacancy", contact: "" }).contact).toBe("contentForm.error.contactRequired");
    expect(errorsOf({ kind: "vacancy", contact: "x".repeat(201) }).contact).toBe("contentForm.error.contactTooLong");
    expect(errorsOf({ kind: "vacancy", contact: "9800000000" }).contact).toBeUndefined();
    expect(errorsOf({ kind: "notice", contact: "" }).contact).toBeUndefined();
    expect(errorsOf({ kind: "notice", contact: "x".repeat(500) }).contact).toBeUndefined();
  });

  it("the start day is required and must look like a Nepali date, year first", () => {
    expect(errorsOf({ publishOnBs: "" }).publishOnBs).toBe("contentForm.error.dateRequired");
    for (const bad of ["2083-6-10", "10-06-2083", "20830610", "abc", "2083/06/10"]) {
      expect(errorsOf({ publishOnBs: bad }).publishOnBs, bad).toBe("contentForm.error.dateShape");
    }
    expect(errorsOf({ publishOnBs: "2083-06-10" }).publishOnBs).toBeUndefined();
    expect(errorsOf({ publishOnBs: "  2083-06-10  " }).publishOnBs, "surrounding blanks are ignored").toBeUndefined();
  });

  it("the hide-after day is optional, but when given must look right and not come before the start day", () => {
    expect(errorsOf({ hideAfterBs: "" }).hideAfterBs).toBeUndefined();
    expect(errorsOf({ hideAfterBs: "2083-6-1" }).hideAfterBs).toBe("contentForm.error.dateShape");
    expect(errorsOf({ publishOnBs: "2083-06-10", hideAfterBs: "2083-06-09" }).hideAfterBs).toBe("contentForm.error.hideBeforeShow");
    expect(errorsOf({ publishOnBs: "2083-06-10", hideAfterBs: "2083-06-10" }).hideAfterBs).toBeUndefined();
    expect(errorsOf({ publishOnBs: "2083-06-10", hideAfterBs: "2083-07-01" }).hideAfterBs).toBeUndefined();
    expect(errorsOf({ publishOnBs: "2083-12-30", hideAfterBs: "2084-01-01" }).hideAfterBs).toBeUndefined();
    expect(errorsOf({ publishOnBs: "2083-10-01", hideAfterBs: "2083-09-30" }).hideAfterBs).toBe("contentForm.error.hideBeforeShow");
  });

  it("does not compare the two days when the start day is itself wrong (one message at a time)", () => {
    expect(errorsOf({ publishOnBs: "nope", hideAfterBs: "2083-01-01" })).toEqual({ publishOnBs: "contentForm.error.dateShape" });
  });

  it("reports every problem at once", () => {
    expect(Object.keys(errorsOf({ title: "", body: "", publishOnBs: "" })).sort()).toEqual(["body", "publishOnBs", "title"]);
  });
});

describe("firstInvalid", () => {
  it("names the first problem in the order the form shows its fields", () => {
    expect(firstInvalid({ publishOnBs: "contentForm.error.dateRequired", title: "contentForm.error.titleRequired" })).toBe("title");
    expect(firstInvalid({ hideAfterBs: "contentForm.error.dateShape", contact: "contentForm.error.contactRequired" })).toBe("contact");
    expect(firstInvalid({})).toBeNull();
  });
});

describe("formatBsDate", () => {
  it("writes a Nepali date with the month's name, without a leading zero on the day", () => {
    expect(formatBsDate("2083-06-05")).toBe("5 Ashwin 2083");
    expect(formatBsDate("2083-01-30")).toBe("30 Baisakh 2083");
    expect(formatBsDate("2083-12-01")).toBe("1 Chaitra 2083");
  });

  it("uses the same month names as the date module, in the catalog", () => {
    BS_MONTH_NAMES.forEach((name, index) => {
      expect(en[`date.month.${index + 1}` as keyof typeof en], `month ${index + 1}`).toBe(name);
    });
  });

  it("shows a dash for a day that is not known or not shaped right", () => {
    for (const bad of [null, "", "2083-13-01", "2083-00-10", "2083-06-00", "garbage", "2083-6-5"]) expect(formatBsDate(bad), String(bad)).toBe("—");
  });
});

describe("paragraphs", () => {
  it("splits on blank lines, trims each, and drops empty ones", () => {
    expect(paragraphs("One\n\nTwo\n\n\n\n  Three  \n")).toEqual(["One", "Two", "Three"]);
    expect(paragraphs("Single line\nstill the same paragraph")).toEqual(["Single line\nstill the same paragraph"]);
    expect(paragraphs("   ")).toEqual([]);
  });

  it("keeps markup as text: nothing is interpreted", () => {
    expect(paragraphs("<script>alert(1)</script>")).toEqual(["<script>alert(1)</script>"]);
  });
});

describe("splitBs and joinBs: a day held as year, month and day pieces", () => {
  it("splits a Nepali day into its pieces, and gives blank pieces for nothing", () => {
    expect(splitBs("2083-06-05")).toEqual({ year: "2083", month: "6", day: "5" });
    expect(splitBs("2083-12-30")).toEqual({ year: "2083", month: "12", day: "30" });
    expect(splitBs("")).toEqual({ year: "", month: "", day: "" });
  });

  it("splits something that is not a whole day into blanks rather than guessing", () => {
    for (const odd of ["garbage", "2083-6", "20830605"]) expect(splitBs(odd), odd).toEqual({ year: "", month: "", day: "" });
  });

  it("joins the pieces into year-month-day, padding the month and day to two digits", () => {
    expect(joinBs({ year: "2083", month: "6", day: "5" })).toBe("2083-06-05");
    expect(joinBs({ year: "2083", month: "12", day: "30" })).toBe("2083-12-30");
  });

  it("joins no pieces into nothing, so an optional day can be left empty", () => {
    expect(joinBs({ year: "", month: "", day: "" })).toBe("");
    expect(joinBs({ year: " ", month: "", day: "" })).toBe("");
  });

  it("joins part of a day into text that is not a whole day, so the form says what is missing", () => {
    for (const partial of [{ year: "2083", month: "", day: "" }, { year: "", month: "6", day: "5" }, { year: "2083", month: "6", day: "" }]) {
      const text = joinBs(partial);
      expect(text).not.toBe("");
      expect(validateForm({ ...valid, publishOnBs: text }).publishOnBs, JSON.stringify(partial)).toBe("contentForm.error.dateShape");
    }
  });

  it("keeps a wrongly typed year or day so it is reported, not silently fixed", () => {
    expect(validateForm({ ...valid, publishOnBs: joinBs({ year: "83", month: "6", day: "5" }) }).publishOnBs).toBe("contentForm.error.dateShape");
    expect(validateForm({ ...valid, publishOnBs: joinBs({ year: "2083", month: "6", day: "123" }) }).publishOnBs).toBe("contentForm.error.dateShape");
  });

  it("is the same day after splitting and joining", () => {
    for (const day of ["2083-01-01", "2083-06-05", "2000-12-30", "2083-10-31"]) expect(joinBs(splitBs(day))).toBe(day);
  });
});

describe("parseEditTarget: what the edit page was asked to open", () => {
  const id = "0123456789abcdef0123456789abcdef";

  it("no id means a new item", () => {
    expect(parseEditTarget("")).toEqual({ mode: "new" });
    expect(parseEditTarget("?other=1")).toEqual({ mode: "new" });
  });

  it("a well-formed id means that item", () => {
    expect(parseEditTarget(`?id=${id}`)).toEqual({ mode: "edit", id });
    expect(parseEditTarget(`?x=1&id=${id}`)).toEqual({ mode: "edit", id });
  });

  it("anything else in the id slot is invalid, never quietly treated as a new item", () => {
    for (const bad of ["?id=", "?id=abc", `?id=${id.toUpperCase()}`, `?id=${id}0`, "?id=../../etc", "?id=<script>", `?id=${id.slice(1)}`]) {
      expect(parseEditTarget(bad), bad).toEqual({ mode: "invalid" });
    }
  });
});

describe("parseFlash: what the list was told just happened", () => {
  it("knows the two outcomes a form can report, and nothing else", () => {
    expect(parseFlash("?done=created")).toBe("created");
    expect(parseFlash("?done=updated")).toBe("updated");
    for (const bad of ["", "?done=", "?done=deleted", "?done=<b>", "?done=CREATED", "?other=created"]) expect(parseFlash(bad), bad).toBeNull();
  });
});

describe("the words for the content screens", () => {
  const own = Object.entries(en).filter(([key]) => key.startsWith("content") || key.startsWith("date."));

  it("never speak as \"we\" or \"our\": it is unclear who that is (writing.md)", () => {
    for (const [key, text] of own) expect(text, key).not.toMatch(/\b(we|we'll|we're|our|us)\b/i);
  });

  it("name the item in the question that asks before publishing or taking down, and say the action in the button", () => {
    expect(t("content.publishAsk", { title: "Fee notice" })).toBe("Put “Fee notice” on the website?");
    expect(t("content.takeDownAsk", { title: "Fee notice" })).toContain("“Fee notice”");
    expect(en["content.confirmPublish"]).toBe("Publish");
    expect(en["content.confirmTakeDown"]).toBe("Take down");
  });

  it("keep one name for an action from the button to the message that follows it", () => {
    expect(en["content.publish"]).toBe("Publish");
    expect(en["content.done.published"]).toMatch(/^Published\./);
    expect(en["content.takeDown"]).toBe("Take down");
    expect(en["content.done.takenDown"]).toMatch(/^Taken down\./);
    expect(en["contentForm.save"]).toBe("Save draft");
    expect(en["content.done.created"]).toMatch(/^Saved as a draft\./);
  });
});

describe("the lists", () => {
  it("has every kind and every state the server knows", () => {
    expect([...KINDS]).toEqual(["notice", "holiday", "routine", "vacancy", "post"]);
    expect([...STATES]).toEqual(["draft", "waiting", "scheduled", "showing", "expired"]);
  });

  it("has a word for each kind and each state", () => {
    for (const kind of KINDS) expect(en[`content.kind.${kind}` as keyof typeof en], kind).toBeTruthy();
    for (const state of STATES) expect(en[`content.state.${state}` as keyof typeof en], state).toBeTruthy();
  });
});
