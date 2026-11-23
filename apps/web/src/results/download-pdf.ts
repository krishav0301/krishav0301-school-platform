/**
 * Saves a printed document (the grade-point marks card, the mark ledger) as an A4 PDF, made in the person's own browser from
 * the page as drawn, so it looks as it does on screen and prints: the school's fonts, colours and crest, no server step.
 * The two libraries are loaded only when someone asks for a download, so no page carries them. The PDF is a picture of the
 * page: it is for keeping and sending, and its text cannot be searched or copied (the database is the record, never the PDF).
 * A card is one sheet. A long table (a class of 50 or 70 on the ledger) runs over as many sheets as it needs, never cutting a
 * row in two, with its column heads repeated at the top of each sheet.
 */
const A4_MM = { width: 210, height: 297 };
/** The document carries its own margin, so the picture is the whole sheet. */
const MARGIN_MM = 0;

/** A file name made of letters and digits, from any words: "Apsara Singh" -> "Apsara-Singh". */
export const fileSafe = (...parts: string[]): string =>
  parts
    .join(" ")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "document";

/** Where an image `w` by `h` lands on an A4 page inside the margins: as large as fits, centred across, at the top (the whole sheet when the page has the sheet's shape). Pure. */
export function fitOnA4(w: number, h: number): { x: number; y: number; width: number; height: number } {
  const room = { width: A4_MM.width - 2 * MARGIN_MM, height: A4_MM.height - 2 * MARGIN_MM };
  const scale = Math.min(room.width / w, room.height / h);
  const width = w * scale;
  return { x: Math.max(0, (A4_MM.width - width) / 2), y: MARGIN_MM, width, height: h * scale };
}

/**
 * The width a page `height` tall must be drawn at to have A4's shape: a page taller than that is made wider rather than shrunk
 * on the sheet, which left the card narrow with white bands at the sides (the PM, 2026-11-10). A page already A4-shaped or
 * wider-than-tall keeps its width. Pure.
 */
export const widthForA4 = (width: number, height: number): number => Math.max(width, Math.ceil((height * A4_MM.width) / A4_MM.height));

export interface Slice {
  from: number;
  to: number;
  /** Whether the table's column heads are drawn above this slice (every sheet but the first). */
  withHeader: boolean;
}

/**
 * Cuts a tall page into sheets of `pageHeight`, only between rows (`rowBottoms`, ascending, in the same units), the column heads
 * (`headerHeight` tall) repeated on every sheet after the first. A page that fits is one sheet. A row taller than a sheet is cut
 * where the sheet ends rather than looping. Pure.
 */
export function planSheets(totalHeight: number, rowBottoms: readonly number[], headerHeight: number, pageHeight: number): Slice[] {
  if (totalHeight <= pageHeight * 1.01) return [{ from: 0, to: totalHeight, withHeader: false }];
  const slices: Slice[] = [];
  let from = 0;
  while (from < totalHeight - 0.5) {
    const withHeader = slices.length > 0;
    const room = pageHeight - (withHeader ? headerHeight : 0);
    if (totalHeight - from <= room * 1.01) {
      slices.push({ from, to: totalHeight, withHeader });
      break;
    }
    const fits = rowBottoms.filter((b) => b > from + 0.5 && b <= from + room);
    const to = fits.length > 0 ? fits[fits.length - 1]! : from + room;
    slices.push({ from, to, withHeader });
    from = to;
  }
  return slices;
}

export interface Paginate {
  /** The table's rows and its column heads, as selectors inside the node. */
  rows: string;
  header: string;
}

const nextFrame = () => new Promise((done) => requestAnimationFrame(() => done(null)));

/** One sheet: if the page is taller than A4's shape, draw it wider until it is not (wider lines wrap less, so a few passes settle it). */
async function widenToA4(node: HTMLElement): Promise<void> {
  for (let pass = 0; pass < 4; pass++) {
    const wanted = widthForA4(node.scrollWidth, node.scrollHeight);
    if (wanted <= node.scrollWidth) break;
    node.style.width = `${wanted}px`;
    await nextFrame();
  }
}

/**
 * Many one-sheet documents (a whole class's marks cards, D-195) as one A4 PDF, a sheet each, in the order given. Each is drawn as
 * the single download draws it, then kept as a JPEG on the paper's own colour (a PNG of 70 cards would be far too big to send),
 * and its picture let go before the next, so a long class does not hold every picture at once. `onProgress` hears each sheet done.
 */
export async function downloadSheetsAsPdf(nodes: readonly HTMLElement[], filename: string, captureClass: string, onProgress?: (done: number, total: number) => void): Promise<void> {
  const [{ toCanvas, getFontEmbedCSS }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  // Every card uses the same fonts: read and embed them once, not once a card (most of the time a card took).
  const fontEmbedCSS = nodes[0] ? await getFontEmbedCSS(nodes[0]) : undefined;
  for (const [i, node] of nodes.entries()) {
    node.classList.add(captureClass);
    let canvas: HTMLCanvasElement;
    let paper = "";
    try {
      await nextFrame();
      await widenToA4(node);
      const article = node.querySelector("article");
      paper = article ? getComputedStyle(article).backgroundColor : "";
      canvas = await toCanvas(node, { pixelRatio: 1.5, width: node.scrollWidth, height: node.scrollHeight, fontEmbedCSS });
    } finally {
      node.style.width = "";
      node.classList.remove(captureClass);
    }
    // A JPEG has no clear parts: lay the picture on the paper's colour, or on the page's own background where the card has none.
    const flat = document.createElement("canvas");
    flat.width = canvas.width;
    flat.height = canvas.height;
    const g = flat.getContext("2d")!;
    const solid = (c: string) => c !== "" && c !== "transparent" && !/, 0\)$/.test(c);
    g.fillStyle = solid(paper) ? paper : getComputedStyle(document.body).backgroundColor;
    g.fillRect(0, 0, flat.width, flat.height);
    g.drawImage(canvas, 0, 0);
    const at = fitOnA4(flat.width, flat.height);
    if (i > 0) pdf.addPage();
    pdf.addImage(flat.toDataURL("image/jpeg", 0.8), "JPEG", at.x, at.y, at.width, at.height);
    canvas.width = flat.width = 0; // let the pictures go now, not when the whole class is done
    onProgress?.(i + 1, nodes.length);
  }
  pdf.save(`${filename}.pdf`);
}

/**
 * `captureClass` lays the page out for the picture: whole tables, no scroll boxes, as wide as the widest table needs. It is on
 * the page only while the picture is taken, so the person sees nothing change. `paginate` is for a long table: without it the
 * page is fitted on one sheet.
 */
export async function downloadAsPdf(node: HTMLElement, filename: string, captureClass: string, paginate?: Paginate): Promise<void> {
  const [{ toCanvas }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
  const pixelRatio = 2;
  node.classList.add(captureClass);
  let canvas: HTMLCanvasElement;
  let rowBottoms: number[] = [];
  let header = { top: 0, bottom: 0 };
  let paper = "";
  try {
    await nextFrame();
    if (!paginate) await widenToA4(node);
    const top = node.getBoundingClientRect().top;
    if (paginate) {
      rowBottoms = [...node.querySelectorAll(paginate.rows)].map((r) => (r.getBoundingClientRect().bottom - top) * pixelRatio);
      const head = node.querySelector(paginate.header)?.getBoundingClientRect();
      if (head) header = { top: (head.top - top) * pixelRatio, bottom: (head.bottom - top) * pixelRatio };
    }
    const article = node.querySelector("article");
    paper = article ? getComputedStyle(article).backgroundColor : "";
    canvas = await toCanvas(node, { pixelRatio, width: node.scrollWidth, height: node.scrollHeight });
  } finally {
    node.style.width = "";
    node.classList.remove(captureClass);
  }

  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageHeight = Math.round((canvas.width * A4_MM.height) / A4_MM.width);
  const slices = paginate ? planSheets(canvas.height, rowBottoms, header.bottom - header.top, pageHeight) : [{ from: 0, to: canvas.height, withHeader: false }];
  if (slices.length === 1) {
    const at = fitOnA4(canvas.width, canvas.height);
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", at.x, at.y, at.width, at.height);
  } else {
    slices.forEach((slice, i) => {
      const sheet = document.createElement("canvas");
      sheet.width = canvas.width;
      sheet.height = pageHeight;
      const g = sheet.getContext("2d")!;
      // The paper's own colour, taken from the page; a page with none (transparent, alpha 0) is left clear, which a PDF shows as white.
      if (paper && paper !== "transparent" && !/, 0\)$/.test(paper)) {
        g.fillStyle = paper;
        g.fillRect(0, 0, sheet.width, sheet.height);
      }
      let y = 0;
      if (slice.withHeader) {
        const h = header.bottom - header.top;
        g.drawImage(canvas, 0, header.top, canvas.width, h, 0, 0, canvas.width, h);
        y = h;
      }
      g.drawImage(canvas, 0, slice.from, canvas.width, slice.to - slice.from, 0, y, canvas.width, slice.to - slice.from);
      if (i > 0) pdf.addPage();
      pdf.addImage(sheet.toDataURL("image/png"), "PNG", 0, 0, A4_MM.width, A4_MM.height);
    });
  }
  pdf.save(`${filename}.pdf`);
}
