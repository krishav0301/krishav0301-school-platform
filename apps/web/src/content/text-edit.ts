/**
 * What the formatting buttons do to the text box (D-098). Each takes the text and the selection and gives back
 * the new text and where the selection goes, so the buttons only ever write the marks `text-format.ts` reads.
 * Pure, so it is tested without a browser.
 */

export interface Edit {
  text: string;
  start: number;
  end: number;
}

export type InlineMark = "bold" | "italic" | "underline";
export type LineStyle = "paragraph" | "heading" | "bullets" | "numbers";

const MARK: Record<InlineMark, string> = { bold: "**", italic: "*", underline: "__" };

/**
 * Wraps the selection in a mark, or takes the mark off when it is already wrapped. With nothing selected it
 * places an empty pair and puts the cursor between them, ready to type.
 */
export function toggleMark(edit: Edit, mark: InlineMark): Edit {
  const m = MARK[mark];
  const { text, start, end } = edit;
  const before = text.slice(0, start);
  const chosen = text.slice(start, end);
  const after = text.slice(end);
  // Already wrapped just outside the selection: unwrap. (Bold's "**" also ends in "*", so italic checks it is not bold.)
  const wrapped = before.endsWith(m) && after.startsWith(m) && !(mark === "italic" && before.endsWith("**") && after.startsWith("**"));
  if (wrapped && chosen) {
    return { text: before.slice(0, -m.length) + chosen + after.slice(m.length), start: start - m.length, end: end - m.length };
  }
  // Keep surrounding spaces outside the marks: "**word **" would not read as bold.
  const lead = chosen.length - chosen.trimStart().length;
  const trail = chosen.length - chosen.trimEnd().length;
  const core = chosen.trim();
  const next = before + chosen.slice(0, lead) + m + core + m + chosen.slice(chosen.length - trail) + after;
  const from = start + lead + m.length;
  return { text: next, start: from, end: from + core.length };
}

/** Puts the selection in a link, and selects where the address goes so it can be typed straight in. */
export function insertLink(edit: Edit, placeholderLabel: string): Edit {
  const { text, start, end } = edit;
  const label = text.slice(start, end).trim() || placeholderLabel;
  const address = "https://";
  const inserted = `[${label}](${address})`;
  const urlStart = start + label.length + 3;
  return { text: text.slice(0, start) + inserted + text.slice(end), start: urlStart, end: urlStart + address.length };
}

const PREFIX = /^(#{1,3}\s+|[-*•]\s+|\d{1,3}[.)]\s+)/;

/** The style of the line the cursor is on. */
export function lineStyleAt(text: string, at: number): LineStyle {
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  const lineEnd = text.indexOf("\n", at);
  const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  if (/^#{1,3}\s+/.test(line)) return "heading";
  if (/^[-*•]\s+/.test(line)) return "bullets";
  if (/^\d{1,3}[.)]\s+/.test(line)) return "numbers";
  return "paragraph";
}

/**
 * Gives every line the selection touches one style: a heading, a bulleted or numbered list, or plain paragraph
 * text. Whatever style a line had is replaced. Pressing the style a line already has turns it back to plain.
 */
export function setLineStyle(edit: Edit, style: LineStyle): Edit {
  const { text, start, end } = edit;
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const toBreak = text.indexOf("\n", Math.max(end - (end > start && text[end - 1] === "\n" ? 1 : 0), start));
  const to = toBreak === -1 ? text.length : toBreak;
  const lines = text.slice(from, to).split("\n");
  // An empty line starts the style, with the cursor after its mark, ready to type (admin FUT F-12).
  if (lines.length === 1 && !lines[0]!.replace(PREFIX, "").trim() && style !== "paragraph") {
    const mark = style === "heading" ? "## " : style === "bullets" ? "- " : "1. ";
    const already = lineStyleAt(lines[0]!, 0) === style;
    const line = already ? "" : mark;
    return { text: text.slice(0, from) + line + text.slice(to), start: from + line.length, end: from + line.length };
  }
  const same = style !== "paragraph" && lines.every((line) => !line.trim() || lineStyleAt(line, 0) === style);
  const target = same ? "paragraph" : style;

  let number = 0;
  const styled = lines.map((line) => {
    const bare = line.replace(PREFIX, "");
    if (!bare.trim()) return bare;
    if (target === "heading") return `## ${bare}`;
    if (target === "bullets") return `- ${bare}`;
    if (target === "numbers") return `${++number}. ${bare}`;
    return bare;
  });
  const replaced = styled.join("\n");
  return { text: text.slice(0, from) + replaced + text.slice(to), start: from, end: from + replaced.length };
}
