import type { components } from "@/api/schema";
import { MONTH_LABEL } from "@/content/model";
import { formatNpr } from "@/fees/money";
import { t, type MessageKey } from "@/i18n/messages";

/** The Principal's dashboard (D-088): everything shown comes from `GET /api/dashboard/overview`. Pure helpers only. */
export type Overview = components["schemas"]["DashboardOverview"];

/** Morning, afternoon or evening by Nepal's clock (UTC+5:45), whatever the device's own time zone. */
export function greetingKey(now: Date): MessageKey {
  const hour = new Date(now.getTime() + (5 * 60 + 45) * 60_000).getUTCHours();
  if (hour < 12) return "dashboard.greeting.morning";
  if (hour < 17) return "dashboard.greeting.afternoon";
  return "dashboard.greeting.evening";
}

export const STATUS_KEY: Record<Overview["status"], MessageKey> = {
  on_track: "dashboard.status.onTrack",
  attention: "dashboard.status.attention",
  several: "dashboard.status.several",
};

/**
 * A rupee amount for a card: whole rupees below one lakh (NPR 45,000), else lakhs (NPR 28.4 L) or crores (NPR 1.2 Cr)
 * to one decimal, rounded half up. Integer arithmetic on paisa only (CLAUDE.md section 6).
 */
export function compactNpr(paisa: number): string {
  const sign = paisa < 0 ? "-" : "";
  const abs = Math.abs(paisa);
  const LAKH = 10_000_000; // one lakh rupees, in paisa
  const CRORE = 100 * LAKH;
  const tenths = (unit: number) => {
    const n = Math.floor((abs * 10 + unit / 2) / unit);
    return `${Math.floor(n / 10)}.${n % 10}`;
  };
  if (abs >= CRORE) return `${sign}${tenths(CRORE)} Cr`;
  if (abs >= LAKH) return `${sign}${tenths(LAKH)} L`;
  return `${sign}${formatNpr(Math.round(abs / 100) * 100).replace(/\.00$/, "")}`;
}

/** "+5%", "−2%", "0%", or null when there is nothing to compare with (never a made-up change). */
export function changeLabel(percent: number | null): { text: string; direction: "up" | "down" | "flat" } | null {
  if (percent === null) return null;
  if (percent > 0) return { text: `+${percent}%`, direction: "up" };
  if (percent < 0) return { text: `−${Math.abs(percent)}%`, direction: "down" };
  return { text: "0%", direction: "flat" };
}

/** A BS day as "14 Ashwin" for a chart label, from "2083-06-14". */
export function bsDayMonth(dateBs: string | null): string {
  const match = dateBs ? /^\d{4}-(\d{2})-(\d{2})$/.exec(dateBs) : null;
  if (!match) return "";
  return `${Number(match[2])} ${t(MONTH_LABEL[Number(match[1]) - 1]!)}`;
}

/** A BS date as "14 Ashwin 2083", from "2083-06-14". */
export function bsLong(dateBs: string | null): string {
  const match = dateBs ? /^(\d{4})-\d{2}-\d{2}$/.exec(dateBs) : null;
  return match ? `${bsDayMonth(dateBs)} ${match[1]}` : "";
}

/** "just now", "5 minutes ago", "2 hours ago", "1 day ago" from an ISO time. */
export function relativeTime(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return t("dashboard.time.now");
  if (minutes < 60) return t(minutes === 1 ? "dashboard.time.minute" : "dashboard.time.minutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t(hours === 1 ? "dashboard.time.hour" : "dashboard.time.hours", { n: hours });
  const days = Math.floor(hours / 24);
  return t(days === 1 ? "dashboard.time.day" : "dashboard.time.days", { n: days });
}

/** The attention rows, in the reference design's order; a row with nothing waiting is left out. */
export function attentionRows(o: Overview): { id: "approvals" | "fees" | "attendance" | "website"; count: number; title: MessageKey; detail: MessageKey; href: string; tone: "bad" | "warn" | "primary" | "accent" }[] {
  const rows = [
    { id: "approvals" as const, count: o.attention.approvals.count, title: "dashboard.attention.approvals" as MessageKey, detail: "dashboard.attention.approvalsDetail" as MessageKey, href: "/portal/approvals", tone: "bad" as const },
    { id: "fees" as const, count: o.attention.feeFollowUps, title: "dashboard.attention.fees" as MessageKey, detail: "dashboard.attention.feesDetail" as MessageKey, href: "/portal/fees/dues", tone: "warn" as const },
    { id: "attendance" as const, count: o.attention.anomalies.count, title: "dashboard.attention.anomalies" as MessageKey, detail: "dashboard.attention.anomaliesDetail" as MessageKey, href: "/portal/attendance", tone: "primary" as const },
    { id: "website" as const, count: o.attention.websiteDrafts, title: "dashboard.attention.drafts" as MessageKey, detail: "dashboard.attention.draftsDetail" as MessageKey, href: "/portal/content", tone: "accent" as const },
  ];
  return rows.filter((r) => r.count > 0);
}

/** Points for the attendance line, inside a box `width` × `height` with `pad` on every side; 40% to 100% on the y axis. */
export function chartPoints(values: readonly (number | null)[], width: number, height: number, pad: number): { x: number; y: number; value: number | null }[] {
  const n = values.length;
  const step = n > 1 ? (width - 2 * pad) / (n - 1) : 0;
  const y = (v: number) => pad + ((100 - Math.max(40, Math.min(100, v))) / 60) * (height - 2 * pad);
  return values.map((value, i) => ({ x: n > 1 ? pad + i * step : width / 2, y: value === null ? height - pad : y(value), value }));
}
