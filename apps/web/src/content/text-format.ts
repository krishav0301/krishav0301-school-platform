/**
 * The few marks website text may carry (D-098), read into a small tree that `FormattedText` draws with
 * React elements, so nothing typed is ever run as HTML. This is the same reader as the Worker's
 * (`apps/api/src/modules/site/text-format.ts`, which draws the crawler copy of the Notices page); the two
 * cannot share a file, so both are checked against `apps/api/test/fixtures/text-format.json`.
 *
 *   a blank line          a new paragraph (a single line break stays a line break)
 *   ## Heading            a heading line
 *   - item / 1. item      a bulleted or numbered list, one line each
 *   **bold** *italic* __underline__ [words](https://…)
 *
 * A link goes only to http(s), mailto: or tel:; anything else is left as the text it is.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold" | "italic" | "underline"; text: string }
  | { type: "link"; text: string; href: string };

export type Block =
  | { type: "paragraph"; lines: Inline[][] }
  | { type: "heading"; content: Inline[] }
  | { type: "bullets" | "numbers"; items: Inline[][] };

const HEADING = /^#{1,3}\s+(.*)$/;
const BULLET = /^[-*•]\s+(.*)$/;
const NUMBER = /^\d{1,3}[.)]\s+(.*)$/;
const INLINE = /\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*|__(?=\S)([^_\n]+?)(?<=\S)__|\*(?=\S)([^*\n]+?)(?<=\S)\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const SAFE_HREF = /^(https?:\/\/[^\s<>"'`]+|mailto:[^\s<>"'`]+@[^\s<>"'`]+|tel:\+?[\d\-()]{3,24})$/i;

/** A link target, or null when it is not one we allow. */
export const safeHref = (href: string): string | null => (SAFE_HREF.test(href) ? href : null);

export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  const text = (value: string) => {
    if (!value) return;
    const last = out[out.length - 1];
    if (last?.type === "text") last.text += value;
    else out.push({ type: "text", text: value });
  };
  let at = 0;
  for (const match of line.matchAll(INLINE)) {
    text(line.slice(at, match.index));
    const [whole, bold, underline, italic, label, href] = match;
    if (bold !== undefined) out.push({ type: "bold", text: bold });
    else if (underline !== undefined) out.push({ type: "underline", text: underline });
    else if (italic !== undefined) out.push({ type: "italic", text: italic });
    else if (label !== undefined && href !== undefined && safeHref(href)) out.push({ type: "link", text: label, href });
    else text(whole);
    at = match.index + whole.length;
  }
  text(line.slice(at));
  return out;
}

/** Reads text into blocks, line by line. */
export function parseText(body: string): Block[] {
  const blocks: Block[] = [];
  // The block being filled, held in an object so the type checker follows it through `close`.
  const current: { open: Block | null } = { open: null };
  const close = () => {
    if (current.open) blocks.push(current.open);
    current.open = null;
  };
  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      close();
      continue;
    }
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const number = bullet ? null : NUMBER.exec(line);
    if (heading) {
      close();
      blocks.push({ type: "heading", content: parseInline(heading[1]!.trim()) });
    } else if (bullet || number) {
      const type = bullet ? "bullets" : "numbers";
      const item = parseInline((bullet ?? number)![1]!.trim());
      const open = current.open;
      if (open?.type === type) open.items.push(item);
      else {
        close();
        current.open = { type, items: [item] };
      }
    } else if (current.open?.type === "paragraph") {
      current.open.lines.push(parseInline(line));
    } else {
      close();
      current.open = { type: "paragraph", lines: [parseInline(line)] };
    }
  }
  close();
  return blocks;
}

/** The words alone, with the marks taken out: for a one-line excerpt in a list. */
export function plainText(body: string): string {
  const words = (parts: Inline[]) => parts.map((part) => part.text).join("");
  return parseText(body)
    .map((block) => {
      if (block.type === "heading") return words(block.content);
      if (block.type === "paragraph") return block.lines.map(words).join(" ");
      return block.items.map(words).join(" · ");
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
