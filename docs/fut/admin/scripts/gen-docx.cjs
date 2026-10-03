// Builds docs/fut/admin/admin-fut.docx from docs/fut/admin/README.md and its screenshots, for readers who want a Word file.
// Handles only the Markdown the README generator writes: headings, paragraphs, bullets, tables, step anchors and images.
// Run: node docs/fut/admin/scripts/gen-docx.cjs [folder] [file name]
// With no arguments it builds the admin FUT; `docs/fut/coordinator coordinator-fut.docx` builds the Co-ordinator's.
const fs = require("fs");
const path = require("path");
const d = require("docx");

const DIR = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, "..");
const SRC = path.join(DIR, "README.md");
const OUT = path.join(DIR, process.argv[3] ?? "admin-fut.docx");

// A4 portrait, 2 cm margins: the text block is 170 mm wide.
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 1134;
const TEXT_W = PAGE_W - 2 * MARGIN; // DXA
const TEXT_W_PX = Math.round((TEXT_W / 1440) * 96);
const MAX_IMG_H_PX = Math.round(((PAGE_H - 2 * MARGIN) / 1440) * 96) - 90; // leave room for the step caption

const C = {
  ink: "1D1D1F",
  muted: "6E6E73",
  accent: "1F4FD1",
  rule: "D2D2D7",
  headFill: "F2F2F5",
  pass: "1E7B34",
  passFill: "E8F5EC",
  warn: "8A5A00",
  warnFill: "FFF4DC",
  high: "B42318",
};
const FONT = "Calibri";

// JPEG size from the first SOF marker.
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

const bookmarkId = (s) => "s_" + s.replace(/[^A-Za-z0-9]/g, "_").slice(0, 36);

// Inline Markdown: **bold**, `code`, [text](link). Links to #anchors become internal links; others plain text.
function inline(text, base = {}) {
  const out = [];
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m;
  const run = (t, o = {}) => new d.TextRun({ text: t, font: FONT, color: C.ink, ...base, ...o });
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(run(text.slice(last, m.index)));
    if (m[2]) out.push(...inline(m[2], { ...base, bold: true }));
    else if (m[4]) out.push(run(m[4], { font: "Consolas", size: (base.size ?? 21) - 2 }));
    else if (m[6]) {
      const target = m[7];
      if (target.startsWith("#"))
        out.push(new d.InternalHyperlink({ anchor: bookmarkId(target.slice(1)), children: [run(m[6], { color: C.accent, underline: {} })] }));
      else out.push(...inline(m[6], base));
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(run(text.slice(last)));
  return out;
}

const splitRow = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

// Column widths by table kind (fractions of the text width), falling back to content length.
function widths(header) {
  const key = header.join("|");
  const known = {
    "#|Step|Result|Page": [0.1, 0.56, 0.12, 0.22],
    "#|Step|Observed on screen|Result": [0.09, 0.42, 0.37, 0.12],
    "ID|Severity|Where|What happens|Steps": [0.07, 0.11, 0.17, 0.5, 0.15],
    "ID|Severity|Where|What the first run found|Fixed (D-100, D-102)|Steps": [0.06, 0.09, 0.14, 0.31, 0.29, 0.11],
    "Permission|What|Tested in": [0.34, 0.4, 0.26],
    "What|Made by|Detail": [0.17, 0.2, 0.63],
  };
  let f = known[key];
  if (!f && header[0].startsWith("What ") && header.length === 3) f = [0.45, 0.4, 0.15];
  if (!f) f = header.map(() => 1 / header.length);
  const w = f.map((x) => Math.floor(x * TEXT_W));
  w[w.length - 1] += TEXT_W - w.reduce((a, b) => a + b, 0);
  return w;
}

function resultStyle(text) {
  if (/^Pass/.test(text)) return { fill: C.passFill, color: C.pass };
  if (/^See F-/.test(text)) return { fill: C.warnFill, color: C.warn };
  if (/^High$/.test(text)) return { fill: "FDECEA", color: C.high };
  if (/^Medium/.test(text)) return { fill: C.warnFill, color: C.warn };
  if (/^403$/.test(text)) return { fill: C.passFill, color: C.pass };
  return null;
}

const border = { style: d.BorderStyle.SINGLE, size: 4, color: C.rule };
function table(rows) {
  const header = rows[0];
  const w = widths(header);
  const cell = (text, i, isHead) => {
    const st = !isHead && resultStyle(text);
    return new d.TableCell({
      width: { size: w[i], type: d.WidthType.DXA },
      shading: isHead ? { type: d.ShadingType.CLEAR, color: "auto", fill: C.headFill } : st ? { type: d.ShadingType.CLEAR, color: "auto", fill: st.fill } : undefined,
      margins: { top: 60, bottom: 60, left: 90, right: 90 },
      borders: { top: border, bottom: border, left: border, right: border },
      children: [
        new d.Paragraph({
          spacing: { before: 0, after: 0 },
          children: inline(text.replace(/^–$/, "–"), { size: 18, bold: isHead || undefined, color: st ? st.color : C.ink }),
        }),
      ],
    });
  };
  return new d.Table({
    width: { size: TEXT_W, type: d.WidthType.DXA },
    columnWidths: w,
    rows: rows.map(
      (r, ri) =>
        new d.TableRow({
          tableHeader: ri === 0,
          cantSplit: true,
          children: header.map((_, i) => cell(r[i] ?? "", i, ri === 0)),
        }),
    ),
  });
}

function image(rel) {
  const buf = fs.readFileSync(path.join(DIR, rel));
  const size = jpegSize(buf) ?? { w: 1440, h: 900 };
  let w = Math.min(TEXT_W_PX, size.w);
  let h = Math.round((size.h * w) / size.w);
  if (h > MAX_IMG_H_PX) {
    h = MAX_IMG_H_PX;
    w = Math.round((size.w * h) / size.h);
  }
  return new d.Paragraph({
    alignment: d.AlignmentType.CENTER,
    spacing: { before: 60, after: 280 },
    children: [
      new d.ImageRun({
        type: "jpg",
        data: buf,
        transformation: { width: w, height: h },
        outline: { type: "solidFill", solidFillType: "rgb", value: C.rule },
      }),
    ],
  });
}

// --- Parse the README into blocks.
const lines = fs.readFileSync(SRC, "utf8").split("\n");
const title = lines[0].replace(/^# /, "");
const body = [];
const toc = [];
let pendingAnchor = null;
let firstSection = true;
for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) continue;
  let m;
  if ((m = /^<a id="([^"]+)"><\/a>$/.exec(line))) {
    pendingAnchor = m[1];
    continue;
  }
  if ((m = /^(#{2,3}) (.*)$/.exec(line))) {
    const level = m[1].length === 2 ? d.HeadingLevel.HEADING_1 : d.HeadingLevel.HEADING_2;
    // Each numbered area starts on a new page.
    const newPage = m[1].length === 2 && /^\d+\./.test(m[2]) ? true : m[1].length === 2 && m[2] === "Findings";
    if (newPage && firstSection) firstSection = false;
    const id = bookmarkId("h-" + m[2]);
    if (m[1].length === 2) toc.push({ text: m[2].replace(/\*\*|`/g, ""), id });
    body.push(new d.Paragraph({ heading: level, pageBreakBefore: newPage, children: [new d.Bookmark({ id, children: inline(m[2]) })] }));
    continue;
  }
  if (line.startsWith("|")) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith("|")) {
      if (!/^\|[\s|:-]+\|$/.test(lines[i].trim())) rows.push(splitRow(lines[i]));
      i++;
    }
    i--;
    body.push(table(rows));
    body.push(new d.Paragraph({ spacing: { before: 0, after: 120 }, children: [] }));
    continue;
  }
  if ((m = /^!\[[^\]]*\]\(([^)]+)\)$/.exec(line))) {
    body.push(image(m[1]));
    continue;
  }
  if ((m = /^\*\*(\d\d-\d\d[a-z]?)\*\* (.*)$/.exec(line))) {
    const children = [
      new d.TextRun({ text: m[1] + "  ", bold: true, font: FONT, color: C.accent, size: 21 }),
      ...inline(m[2], { size: 21 }),
    ];
    body.push(
      new d.Paragraph({
        keepNext: true,
        spacing: { before: 120, after: 40 },
        children: pendingAnchor ? [new d.Bookmark({ id: bookmarkId(pendingAnchor), children }), ...[]] : children,
      }),
    );
    pendingAnchor = null;
    continue;
  }
  if ((m = /^- (.*)$/.exec(line))) {
    body.push(new d.Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 60 }, children: inline(m[1]) }));
    continue;
  }
  if ((m = /^Observed: (.*)$/.exec(line)) || (m = /^> (.*)$/.exec(line))) {
    body.push(new d.Paragraph({ keepNext: true, spacing: { after: 40 }, children: inline(m[1], { italics: true, color: C.muted, size: 19 }) }));
    continue;
  }
  body.push(new d.Paragraph({ spacing: { after: 120 }, children: inline(line) }));
}

// --- Cover and contents.
const intro = lines.find((l, i) => i > 0 && l.trim() && !l.startsWith("#"));
const cover = [
  new d.Paragraph({ spacing: { before: 3200, after: 200 }, children: [new d.TextRun({ text: "Functional user test", font: FONT, size: 28, color: C.muted })] }),
  new d.Paragraph({ spacing: { after: 300 }, children: [new d.TextRun({ text: title.replace(/ functional user test \(FUT\)$/, ""), font: FONT, size: 60, bold: true, color: C.ink })] }),
  new d.Paragraph({
    spacing: { after: 600 },
    border: { bottom: { style: d.BorderStyle.SINGLE, size: 8, color: C.accent, space: 8 } },
    children: [new d.TextRun({ text: "Royal Softech College · School platform", font: FONT, size: 26, color: C.ink })],
  }),
  new d.Paragraph({ spacing: { after: 200 }, children: inline(intro, { size: 22, color: C.muted }) }),
  new d.Paragraph({ pageBreakBefore: true, heading: d.HeadingLevel.HEADING_1, children: [new d.TextRun({ text: "Contents" })] }),
  ...toc.map(
    (t) =>
      new d.Paragraph({
        spacing: { after: 80 },
        border: { bottom: { style: d.BorderStyle.SINGLE, size: 2, color: C.rule, space: 4 } },
        children: [new d.InternalHyperlink({ anchor: t.id, children: [new d.TextRun({ text: t.text, font: FONT, size: 22, color: C.accent })] })],
      }),
  ),
];
// Drop the intro paragraph from the body: it is on the cover.
const introIdx = body.findIndex((p) => p instanceof d.Paragraph);
if (introIdx === 0) body.shift();

const doc = new d.Document({
  title,
  creator: "School platform",
  styles: {
    default: { document: { run: { font: FONT, size: 21, color: C.ink }, paragraph: { spacing: { line: 276, lineRule: d.LineRuleType.AUTO } } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 34, bold: true, color: C.ink, font: FONT }, paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 0, keepNext: true } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 26, bold: true, color: C.ink, font: FONT }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1, keepNext: true } },
    ],
  },
  numbering: {
    config: [{ reference: "bullets", levels: [{ level: 0, format: d.LevelFormat.BULLET, text: "•", alignment: d.AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }] }],
  },
  sections: [
    {
      properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } }, titlePage: true },
      headers: {
        default: new d.Header({ children: [new d.Paragraph({ alignment: d.AlignmentType.RIGHT, children: [new d.TextRun({ text: title, size: 16, color: C.muted, font: FONT })] })] }),
      },
      footers: {
        default: new d.Footer({
          children: [
            new d.Paragraph({
              alignment: d.AlignmentType.CENTER,
              children: [new d.TextRun({ children: ["Page ", d.PageNumber.CURRENT, " of ", d.PageNumber.TOTAL_PAGES], size: 16, color: C.muted, font: FONT })],
            }),
          ],
        }),
      },
      children: [...cover, ...body],
    },
  ],
});

// docx gives every bookmark w:id="1"; Word wants them unique. Bookmarks here never nest, so number each start-end pair.
async function fixBookmarkIds(buf) {
  const JSZip = require(require.resolve("jszip", { paths: [path.dirname(require.resolve("docx"))] }));
  const zip = await JSZip.loadAsync(buf);
  let xml = await zip.file("word/document.xml").async("string");
  let n = 0;
  xml = xml.replace(/<w:bookmark(Start|End)\b([^>]*?)w:id="\d+"/g, (_, kind, rest) => {
    if (kind === "Start") n++;
    return `<w:bookmark${kind}${rest}w:id="${n}"`;
  });
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

d.Packer.toBuffer(doc).then(fixBookmarkIds).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log(`written ${path.relative(process.cwd(), OUT)} (${(buf.length / 1048576).toFixed(1)} MB)`);
});
