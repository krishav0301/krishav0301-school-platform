import jsQR from "jsqr";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { QrCode, qrMatrix } from "@/two-factor/qr";

/** Draws a matrix the way a screen would (black on white, four modules of quiet space) and reads it back with a real decoder. */
function decode(rows: boolean[][], scale = 6, quiet = 4): string | null {
  const size = (rows.length + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  rows.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const at = (((y + quiet) * scale + dy) * size + (x + quiet) * scale + dx) * 4;
          pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
        }
      }
    }),
  );
  return jsQR(pixels, size, size)?.data ?? null;
}

const URI = "otpauth://totp/Example%20College:admin%40school.example?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Example%20College&algorithm=SHA1&digits=6&period=30";

describe("qrMatrix", () => {
  it("is a square grid, and what a real QR reader decodes from it is exactly the text that went in", () => {
    const rows = qrMatrix(URI);
    expect(rows.length).toBeGreaterThanOrEqual(21);
    for (const row of rows) expect(row).toHaveLength(rows.length);
    expect(decode(rows)).toBe(URI);
  });

  it("holds for short text, for a long one, and for characters that need escaping", () => {
    for (const text of ["x", "otpauth://totp/A:b?secret=ABCDEFGH", URI + "&extra=" + "z".repeat(120), "a b&c=d/é".replace("é", "%C3%A9")]) {
      expect(decode(qrMatrix(text)), text.slice(0, 30)).toBe(text);
    }
  });

  it("keeps a margin for damage: error correction M (a 154-character address needs a 53-module grid; level L would need 45)", () => {
    expect(qrMatrix(URI)).toHaveLength(53);
  });

  it("still reads after a smudge over part of it, which is what the margin is for", () => {
    const rows = qrMatrix(URI).map((row) => [...row]);
    // Blank a 5 x 5 patch in the data area, as a fingerprint or a reflection might.
    for (let y = 30; y < 35; y++) for (let x = 30; x < 35; x++) rows[y]![x] = false;
    expect(decode(rows)).toBe(URI);
  });

  it("has the three finder squares every reader looks for, in three corners and not the fourth", () => {
    const rows = qrMatrix(URI);
    const n = rows.length;
    const finder = (top: number, left: number) => [0, 6].every((d) => rows[top]![left + d] && rows[top + 6]![left + d] && rows[top + d]![left] && rows[top + d]![left + 6]);
    expect(finder(0, 0)).toBe(true);
    expect(finder(0, n - 7)).toBe(true);
    expect(finder(n - 7, 0)).toBe(true);
    expect(finder(n - 7, n - 7)).toBe(false);
  });
});

describe("QrCode", () => {
  const html = renderToStaticMarkup(<QrCode text={URI} label="QR code for the setup key" />);

  it("is one image with a text name for screen readers, never a picture with no name", () => {
    expect(html).toMatch(/^<svg[^>]*role="img"[^>]*aria-label="QR code for the setup key"/);
    expect(html.match(/<svg/g)).toHaveLength(1);
  });

  it("draws every dark module once, on a white background with quiet space around it", () => {
    const rows = qrMatrix(URI);
    const dark = rows.flat().filter(Boolean).length;
    const path = /<path[^>]*\bd="([^"]*)"/.exec(html)![1]!;
    expect(path.match(/M/g)).toHaveLength(dark);
    const size = rows.length + 8;
    expect(html).toContain(`viewBox="0 0 ${size} ${size}"`);
    expect(html).toMatch(/<rect[^>]*fill="white"/);
    expect(html).toMatch(/<path[^>]*fill="black"/);
    expect(html).toContain('shape-rendering="crispEdges"');
  });

  it("what is DRAWN reads back too: rebuilding the grid from the picture's own path decodes to the exact text", () => {
    const size = qrMatrix(URI).length;
    const path = /<path[^>]*\bd="([^"]*)"/.exec(html)![1]!;
    const rows = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
    for (const [, x, y] of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) rows[Number(y) - 4]![Number(x) - 4] = true;
    expect(decode(rows)).toBe(URI);
  });

  it("carries no address and no script: nothing to fetch, nothing to run", () => {
    expect(html).not.toMatch(/href=|src=|<script|<image|<foreignObject|https?:/i);
  });

  it("does not put the text it encodes anywhere in the markup (the secret is in the picture, not in a second copy)", () => {
    expect(html).not.toContain("JBSWY3DP");
    expect(html).not.toContain("otpauth");
  });
});

describe("a machine-readable code is the one place a fixed colour is allowed", () => {
  const src = join(import.meta.dirname, "..", "src");
  function* walk(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) yield* walk(path);
      else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) yield path;
    }
  }

  it("says why, and no other component names black or white", () => {
    const owners = [...walk(src)].filter((f) => /["'](black|white)["']/.test(readFileSync(f, "utf8"))).map((f) => relative(src, f).split(sep).join("/"));
    expect(owners).toEqual(["two-factor/qr.tsx"]);
    expect(readFileSync(join(src, "two-factor", "qr.tsx"), "utf8")).toMatch(/scan/i);
  });
});
