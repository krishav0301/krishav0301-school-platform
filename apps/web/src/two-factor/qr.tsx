import qrcode from "qrcode-generator";

/**
 * A QR code, drawn as one SVG path from the generator's own grid (`qrcode-generator`, MIT, no dependencies).
 * Nothing is fetched and nothing leaves the page: the setup key is turned into a picture right here.
 *
 * The colours are FIXED, black on white, on purpose. A QR code is read by a machine, not a person: phone
 * cameras and authenticator apps scan reliably only dark-on-light with quiet space around it, and a
 * school's theme (which may be light on dark) must not be able to make it unreadable. This is the one place
 * the "no hardcoded colours" rule does not apply, and a test keeps it the only one.
 */
const DARK = "black";
const LIGHT = "white";

/** The quiet zone a QR code needs on every side, in modules. The standard asks for four. */
const QUIET = 4;

/** The code's grid: true where a module is dark. Error correction M (about 15% can be damaged and still read). */
export function qrMatrix(text: string): boolean[][] {
  const code = qrcode(0, "M");
  code.addData(text);
  code.make();
  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => code.isDark(row, col)));
}

export function QrCode({ text, label, className }: { text: string; label: string; className?: string }) {
  const rows = qrMatrix(text);
  const size = rows.length + QUIET * 2;
  // One small square per dark module, in one path, so the picture is a few kilobytes at most.
  const path = rows.map((row, y) => row.map((dark, x) => (dark ? `M${x + QUIET} ${y + QUIET}h1v1h-1z` : "")).join("")).join("");

  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" className={className}>
      <rect width={size} height={size} fill={LIGHT} />
      <path d={path} fill={DARK} />
    </svg>
  );
}
