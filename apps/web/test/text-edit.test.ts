import { describe, expect, it } from "vitest";

import { parseText } from "@/content/text-format";
import { insertLink, lineStyleAt, setLineStyle, toggleMark, type Edit } from "@/content/text-edit";

/** "a [b] c": the text with the selection marked by brackets, to keep the cases readable. */
function at(marked: string): Edit {
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  return { text: marked.replace("[", "").replace("]", ""), start, end };
}
const show = (edit: Edit) => edit.text.slice(0, edit.start) + "[" + edit.text.slice(edit.start, edit.end) + "]" + edit.text.slice(edit.end);

describe("the formatting buttons (D-098)", () => {
  it("wrap the chosen words in the mark the website reads, keeping them chosen", () => {
    expect(show(toggleMark(at("Classes start [Sunday] at ten"), "bold"))).toBe("Classes start **[Sunday]** at ten");
    expect(show(toggleMark(at("[ten AM]"), "italic"))).toBe("*[ten AM]*");
    expect(show(toggleMark(at("bring [ID]"), "underline"))).toBe("bring __[ID]__");
  });

  it("press again to take the mark off", () => {
    expect(show(toggleMark(toggleMark(at("a [b] c"), "bold"), "bold"))).toBe("a [b] c");
    expect(show(toggleMark(toggleMark(at("a [b] c"), "italic"), "italic"))).toBe("a [b] c");
  });

  it("italic inside bold adds a mark rather than unwrapping the bold", () => {
    expect(toggleMark(at("**[b]**"), "italic").text).toBe("***b***");
  });

  it("keep spaces outside the marks, so the result really reads as bold", () => {
    const edit = toggleMark(at("say[ hello ]there"), "bold");
    expect(edit.text).toBe("say **hello** there");
    expect(parseText(edit.text)).toEqual([{ type: "paragraph", lines: [[{ type: "text", text: "say " }, { type: "bold", text: "hello" }, { type: "text", text: " there" }]] }]);
  });

  it("with nothing chosen, place an empty pair and put the cursor inside", () => {
    expect(show(toggleMark(at("x []y"), "bold"))).toBe("x **[]**y");
  });

  it("make a link from the chosen words and choose where the address goes", () => {
    const edit = insertLink(at("see [the office] now"), "Link");
    expect(edit.text).toBe("see [the office](https://) now");
    expect(edit.text.slice(edit.start, edit.end)).toBe("https://");
    expect(insertLink(at("[]"), "Link").text).toBe("[Link](https://)");
  });

  it("turn the chosen lines into a list, a heading or plain text, replacing whatever they were", () => {
    expect(setLineStyle(at("[Science\nArts]"), "bullets").text).toBe("- Science\n- Arts");
    expect(setLineStyle(at("[- Science\n- Arts]"), "numbers").text).toBe("1. Science\n2. Arts");
    expect(setLineStyle(at("Intro\n[Fees]\nmore"), "heading").text).toBe("Intro\n## Fees\nmore");
    expect(setLineStyle(at("[## Fees]"), "paragraph").text).toBe("Fees");
  });

  it("pressing the style a line already has turns it back to plain text", () => {
    expect(setLineStyle(at("[- a\n- b]"), "bullets").text).toBe("a\nb");
  });

  it("know the style of the line the cursor is on", () => {
    const text = "Intro\n## Fees\n- one\n2. two";
    expect(lineStyleAt(text, 2)).toBe("paragraph");
    expect(lineStyleAt(text, 8)).toBe("heading");
    expect(lineStyleAt(text, 16)).toBe("bullets");
    expect(lineStyleAt(text, text.length)).toBe("numbers");
  });

  it("everything the buttons write reads back as the mark it means", () => {
    let edit = toggleMark(at("[Pay]"), "bold");
    edit = { ...edit, text: edit.text + "\n- by Friday" };
    expect(parseText(edit.text).map((b) => b.type)).toEqual(["paragraph", "bullets"]);
  });
});

describe("a list or heading started on an empty line (admin FUT F-12)", () => {
  it("puts the mark there with the cursor after it, ready to type; pressed again it takes it off", () => {
    expect(setLineStyle({ text: "", start: 0, end: 0 }, "bullets")).toEqual({ text: "- ", start: 2, end: 2 });
    expect(setLineStyle({ text: "Intro\n", start: 6, end: 6 }, "numbers")).toEqual({ text: "Intro\n1. ", start: 9, end: 9 });
    expect(setLineStyle({ text: "Intro\n- ", start: 8, end: 8 }, "bullets")).toEqual({ text: "Intro\n", start: 6, end: 6 });
  });
});
