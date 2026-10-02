import { describe, expect, it } from "vitest";

import { BS_MONTH_NAMES } from "../../api/src/core/dates";
import { en, t } from "@/i18n/messages";
import { GROUPS, KINDS, STATES, contactHref, emptyForm, firstInvalid, formFromItem, formatBsDate, formatTime, holidayLine, joinBs, parseEditTarget, parseFlash, parseNewKind, splitBs, validateForm, type FormValues } from "@/content/model";

const valid: FormValues = { kind: "notice", title: "Winter break", body: "Closed on Friday.", contact: "", urgent: false, publishOnBs: "2083-06-10", publishTime: "10:00", hideAfterBs: "", holidayFromBs: "", holidayToBs: "" };
const errorsOf = (over: Partial<FormValues>) => validateForm({ ...valid, ...over });

describe("a new form", () => {
  it("starts as News (D-098), shown from today's Nepali date at the time now, and nothing else filled in", () => {
    expect(emptyForm("2083-06-05", undefined, "14:35")).toEqual({ kind: "post", title: "", body: "", contact: "", urgent: false, publishOnBs: "2083-06-05", publishTime: "14:35", hideAfterBs: "", holidayFromBs: "", holidayToBs: "" });
  });

  it("starts with an empty start day when today's date is not known (past the verified years)", () => {
    expect(emptyForm(null).publishOnBs).toBe("");
  });
});

describe("a form for an existing item", () => {
  it("carries the words and the Nepali days, with blanks instead of nulls", () => {
    const item = { kind: "vacancy", title: "Teacher", body: "Maths", contact: "jobs@school.example", urgent: true, publishOnBs: "2083-01-05", publishTime: "09:30", hideAfterBs: null } as never;
    expect(formFromItem(item)).toEqual({ kind: "vacancy", title: "Teacher", body: "Maths", contact: "jobs@school.example", urgent: true, publishOnBs: "2083-01-05", publishTime: "09:30", hideAfterBs: "", holidayFromBs: "", holidayToBs: "" });
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

describe("the publish time (D-098)", () => {
  it("must be a 24-hour time", () => {
    for (const bad of ["", "24:00", "9:00", "10:60", "noon"]) expect(errorsOf({ publishTime: bad }).publishTime, bad).toBe("contentForm.error.timeRequired");
    for (const good of ["00:00", "09:05", "23:59"]) expect(errorsOf({ publishTime: good }).publishTime, good).toBeUndefined();
  });

  it("reads as a person says it", () => {
    expect(formatTime("00:00")).toBe("12:00 AM");
    expect(formatTime("09:05")).toBe("9:05 AM");
    expect(formatTime("12:30")).toBe("12:30 PM");
    expect(formatTime("23:59")).toBe("11:59 PM");
    expect(formatTime("odd")).toBe("odd");
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

  it("a new item may be asked to start as a known kind (?kind=post, the dashboard's Publish Post, D-089); anything else is ignored", () => {
    expect(parseEditTarget("?kind=post")).toEqual({ mode: "new", kind: "post" });
    expect(parseEditTarget("?kind=vacancy")).toEqual({ mode: "new", kind: "vacancy" });
    expect(parseEditTarget("?kind=evil")).toEqual({ mode: "new" });
    expect(emptyForm("2083-06-05", "vacancy").kind).toBe("vacancy");
    expect(emptyForm("2083-06-05").kind).toBe("post");
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
  it("knows the five outcomes a form can report, and nothing else", () => {
    expect(parseFlash("?done=scheduled")).toBe("scheduled");
    expect(parseFlash("?done=created")).toBe("created");
    expect(parseFlash("?done=updated")).toBe("updated");
    expect(parseFlash("?done=published")).toBe("published");
    expect(parseFlash("?done=saved_unpublished")).toBe("saved_unpublished");
    for (const bad of ["", "?done=", "?done=deleted", "?done=<b>", "?done=CREATED", "?other=created"]) expect(parseFlash(bad), bad).toBeNull();
  });
});

describe("parseNewKind: a new item the list is asked to open (the dashboard's quick action, D-098)", () => {
  it("knows every kind, and nothing else", () => {
    expect(parseNewKind("?new=post")).toBe("post");
    expect(parseNewKind("?new=information")).toBe("information");
    for (const bad of ["", "?new=", "?new=gallery", "?new=POST", "?kind=post"]) expect(parseNewKind(bad), bad).toBeNull();
  });
});

describe("contactHref: a vacancy's contact as a link, only when it is safe to make one", () => {
  it("makes a mail link from an email address", () => {
    expect(contactHref("jobs@school.example")).toBe("mailto:jobs@school.example");
    expect(contactHref("  first.last+jobs@mail.school.example ")).toBe("mailto:first.last+jobs@mail.school.example");
  });

  it("makes a phone link from a phone number, keeping the digits and a leading plus", () => {
    expect(contactHref("9800000000")).toBe("tel:9800000000");
    expect(contactHref("+977 985-1234567")).toBe("tel:+9779851234567");
    expect(contactHref("(033) 560 123")).toBe("tel:033560123");
  });

  it("makes no link from anything else, so what the Admin typed is shown as plain text", () => {
    for (const other of ["Ask at the office", "", "  ", "123", "call 9800000000 today", "jobs@", "@school.example", "a b@school.example"]) {
      expect(contactHref(other), JSON.stringify(other)).toBeNull();
    }
  });

  it("never makes a link with a script or another scheme, whatever is typed", () => {
    for (const hostile of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "jobs@school.example?body=<script>", "vbscript:x", "9800000000;rm", "9800000000\">"]) {
      const href = contactHref(hostile);
      expect(href === null || /^(mailto:[^\s<>"]+|tel:\+?\d+)$/.test(href), hostile).toBe(true);
      expect(href ?? "").not.toMatch(/javascript|data:|script|[<>"]/i);
    }
  });
});

describe("the words for the content screens", () => {
  const own = Object.entries(en).filter(([key]) => key.startsWith("content") || key.startsWith("date."));

  it("never speak as \"we\" or \"our\": it is unclear who that is (writing.md)", () => {
    for (const [key, text] of own) expect(text, key).not.toMatch(/\b(we|we'll|we're|our|us)\b/i);
  });

  it("name the item in what they say after publishing, taking down or undoing, so it is clear which one it was", () => {
    for (const key of ["content.done.published", "content.done.takenDown", "content.undone.draft", "content.undone.published"] as const) {
      expect(t(key, { title: "Fee notice" }), key).toContain("“Fee notice”");
    }
  });

  it("keep one name for an action from the button to the message that follows it", () => {
    expect(en["content.publish"]).toBe("Publish");
    expect(en["content.done.published"]).toMatch(/^Published/);
    expect(en["content.done.formPublished"]).toMatch(/^Published/);
    expect(en["contentForm.publish"]).toBe("Publish");
    expect(en["content.takeDown"]).toBe("Take down");
    expect(en["content.done.takenDown"]).toMatch(/^Taken down/);
    expect(en["contentForm.save"]).toBe("Save draft");
    expect(en["content.done.created"]).toMatch(/^Saved as a draft/);
    expect(en["content.done.savedNotPublished"]).toMatch(/^Saved as a draft/);
  });

  it("describe the undo precisely, as the operation being undone (undo-and-redo.md)", () => {
    expect(en["content.undoPublish"]).toBe("Undo publish");
    expect(en["content.undoTakeDown"]).toBe("Undo take down");
  });
});

describe("the lists", () => {
  it("has every kind and every state the server knows", () => {
    // In the order the type cards show them (D-098): News (the "post" kind) first, Routine last.
    expect([...KINDS]).toEqual(["post", "notice", "holiday", "event", "vacancy", "information", "routine"]);
    expect([...STATES]).toEqual(["draft", "waiting", "scheduled", "showing", "expired", "archived"]);
    expect([...GROUPS]).toEqual(["published", "draft", "scheduled", "archived"]);
  });

  it("has a word for each kind and each state", () => {
    for (const kind of KINDS) expect(en[`content.kind.${kind}` as keyof typeof en], kind).toBeTruthy();
    for (const state of STATES) expect(en[`content.state.${state}` as keyof typeof en], state).toBeTruthy();
    for (const group of GROUPS) expect(en[`content.group.${group}` as keyof typeof en], group).toBeTruthy();
    expect(t("content.kind.post")).toBe("News");
  });
});

describe("a holiday names its own days (D-094)", () => {
  const holiday: FormValues = { ...valid, kind: "holiday", publishOnBs: "2083-06-14", holidayFromBs: "2083-06-16", holidayToBs: "" };
  const holidayErrors = (over: Partial<FormValues>) => validateForm({ ...holiday, ...over });

  it("needs the holiday's day, and never asks for a hide-after day", () => {
    expect(holidayErrors({})).toEqual({});
    expect(holidayErrors({ holidayFromBs: "" })).toEqual({ holidayFromBs: "contentForm.error.holidayRequired" });
    expect(holidayErrors({ hideAfterBs: "2083-01-01" })).toEqual({}); // left over from another kind; not sent
  });

  it("a last day before the first, or showing it only after the holiday, is refused against its own field", () => {
    expect(holidayErrors({ holidayToBs: "2083-06-15" })).toEqual({ holidayToBs: "contentForm.error.holidayEndBeforeStart" });
    expect(holidayErrors({ publishOnBs: "2083-06-17" })).toEqual({ publishOnBs: "contentForm.error.showAfterHoliday" });
    expect(holidayErrors({ publishOnBs: "2083-06-17", holidayToBs: "2083-06-20" })).toEqual({});
  });

  it("the first problem on screen is the holiday's day, which comes before the show-from day", () => {
    expect(firstInvalid({ publishOnBs: "contentForm.error.dateRequired", holidayFromBs: "contentForm.error.holidayRequired" })).toBe("holidayFromBs");
  });

  it("says the holiday's days in words", () => {
    expect(holidayLine("2083-06-16", null)).toBe("Holiday on 16 Ashwin 2083");
    expect(holidayLine("2083-06-16", "2083-06-16")).toBe("Holiday on 16 Ashwin 2083");
    expect(holidayLine("2083-06-16", "2083-06-20")).toBe("Holiday from 16 Ashwin 2083 to 20 Ashwin 2083");
    expect(holidayLine(null, null)).toBeNull();
  });

  it("an existing holiday's form carries its days and not its hide-after day, which the server sets", () => {
    const item = { kind: "holiday", title: "Dashain", body: "Closed", contact: null, urgent: false, publishOnBs: "2083-06-14", hideAfterBs: "2083-06-20", holidayFromBs: "2083-06-16", holidayToBs: "2083-06-20" } as never;
    expect(formFromItem(item)).toMatchObject({ hideAfterBs: "", holidayFromBs: "2083-06-16", holidayToBs: "2083-06-20" });
  });
});
