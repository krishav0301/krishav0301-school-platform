/**
 * Saves a printed document (the grade-point marks card, the mark ledger) as an A4 PDF, made in the person's own browser from
 * the page as drawn, so it looks as it does on screen and prints: the school's fonts, colours and crest, no server step.
 * The two libraries are loaded only when someone asks for a download, so no page carries them. The PDF is a picture of the
 * page: it is for keeping and sending, and its text cannot be searched or copied (the database is the record, never the PDF).
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
  return { x: (A4_MM.width - width) / 2, y: MARGIN_MM, width, height: h * scale };
}

/**
 * `captureClass` lays the page out for the picture: whole tables, no scroll boxes, as wide as the widest table needs. It is on
 * the page only while the picture is taken, so the person sees nothing change.
 */
export async function downloadAsPdf(node: HTMLElement, filename: string, captureClass: string): Promise<void> {
  const [{ toCanvas }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
  node.classList.add(captureClass);
  let canvas: HTMLCanvasElement;
  try {
    await new Promise((done) => requestAnimationFrame(() => done(null)));
    canvas = await toCanvas(node, { pixelRatio: 2, width: node.scrollWidth, height: node.scrollHeight });
  } finally {
    node.classList.remove(captureClass);
  }
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const at = fitOnA4(canvas.width, canvas.height);
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", at.x, at.y, at.width, at.height);
  pdf.save(`${filename}.pdf`);
}
