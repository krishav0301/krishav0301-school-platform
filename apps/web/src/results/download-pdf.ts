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
    await new Promise((done) => requestAnimationFrame(() => done(null)));
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
