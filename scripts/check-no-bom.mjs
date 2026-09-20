// Fails if any tracked text file starts with a byte-order mark. Windows PowerShell 5.1 adds one
// when a file is written with `-Encoding utf8`, and it makes generated files differ in CI.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
const textLike = /\.(ts|tsx|js|mjs|json|jsonc|md|yml|yaml|css|html|sql|toml|txt)$/;
const withBom = files.filter((f) => {
  if (!textLike.test(f)) return false;
  try {
    const head = readFileSync(f).subarray(0, 3);
    return head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf;
  } catch {
    return false;
  }
});

if (withBom.length > 0) {
  console.error("Files start with a byte-order mark:\n" + withBom.map((f) => "  " + f).join("\n"));
  process.exit(1);
}
console.warn(`checked ${files.length} tracked files: no byte-order marks`);
