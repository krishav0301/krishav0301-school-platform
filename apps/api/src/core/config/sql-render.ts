import type { Operation } from "./pack";

/**
 * One value as a SQL literal. Strings are quoted with quotes doubled, so text can never become
 * code. Line breaks and NUL are refused: the output is one statement per line.
 */
function literal(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot write a non-finite number into SQL");
    return String(value);
  }
  if (typeof value !== "string") throw new Error(`Cannot write a ${typeof value} into SQL`);
  if (/[\x00\r\n]/.test(value)) throw new Error("Cannot write a line break or NUL character into SQL");
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Turns operations into plain SQL text, one statement per line, for tools that cannot bind
 * parameters (a `wrangler d1 execute --file` provisioning run). The SQL template is tidied first
 * and the escaped values are put in afterwards, so a value's own spacing is never touched.
 */
export function renderSql(operations: readonly Operation[]): string {
  return operations
    .map((op) => {
      const template = op.sql.replace(/\s+/g, " ").trim();
      let i = 0;
      const text = template.replace(/\?/g, () => {
        if (i >= op.params.length) throw new Error("More placeholders than values");
        return literal(op.params[i++]!);
      });
      if (i !== op.params.length) throw new Error("More values than placeholders");
      return `${text};`;
    })
    .join("\n");
}
