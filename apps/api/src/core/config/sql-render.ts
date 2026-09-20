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

/**
 * Renders SQL that uses numbered placeholders (`?1`, `?2`, ..., the way our services write it,
 * where a number may be used twice) into plain text, for operator scripts that reach a database
 * through the wrangler command line and so cannot bind parameters. Values go through the same
 * `literal` as above, so they can never become code. Text inside a quoted SQL string is left alone.
 * A plain `?` is refused: mixed with numbered ones it is ambiguous.
 */
export function renderNumbered(sql: string, params: readonly (string | number | null)[]): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const char = sql[i]!;

    if (char === "'") {
      // Copy a quoted SQL string as it is, including any doubled quotes inside it.
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    if (char === "?") {
      const match = /^\?(\d+)/.exec(sql.slice(i));
      if (!match) throw new Error("Use numbered placeholders (?1, ?2, ...); a plain ? is ambiguous.");
      const n = Number(match[1]);
      if (n < 1) throw new Error("Placeholders start at ?1.");
      if (n > params.length) throw new Error(`Placeholder ?${n} has no value.`);
      out += literal(params[n - 1]!);
      i += match[0].length;
      continue;
    }

    out += char;
    i++;
  }
  return out;
}
