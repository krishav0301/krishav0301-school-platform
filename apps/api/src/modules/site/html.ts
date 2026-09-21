/** Everything written into a public page's HTML from the database goes through here. */
const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Text safe to put between tags or inside a quoted attribute. */
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

// The two line-separator characters, built from their code points so this file holds no invisible characters.
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/**
 * A structured-data block. `<`, `>` and `&` are written as escapes, so a value can never close the script
 * tag or start another; the two line-separator characters are escaped because JavaScript treats them as line ends.
 * `JSON.parse` turns every escape back into the original character.
 */
export function jsonLdScript(data: unknown): string {
  const json = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .split(LINE_SEPARATOR)
    .join("\\u2028")
    .split(PARAGRAPH_SEPARATOR)
    .join("\\u2029");
  return `<script type="application/ld+json">${json}</script>`;
}
