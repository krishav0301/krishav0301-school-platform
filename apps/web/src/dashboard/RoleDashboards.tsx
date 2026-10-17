"use client";

import { FileText, Scale, Wallet } from "lucide-react";
import { useCallback, useState } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { loadDues, loadStructures } from "@/fees/client";
import { nprShort } from "@/fees/ReadFees";
import { t } from "@/i18n/messages";
import { FigureTiles, OpenLink, Panel, ReadFailure, ReadHeader, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { OVERVIEW_ART, type ArtCode } from "@/ui";
import { useSession, type RoleClaim } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";

import { greetingKey } from "./admin-model";
import { RoleBriefLinks } from "./RoleBrief";

/**
 * The Accountant's home (D-107; the Teacher's and the Student's became a landing page, the PM 2026-10-17), on the pattern of the Principal's: a greeting,
 * up to four figures, today's work as rows with the page to act on it, and what the role can do. Every figure and row
 * comes from an API the role already uses on its own screen, so a home never shows what that screen would not.
 */

export interface DayRow {
  key: string;
  title: string;
  meta: string;
  /** To do, Done, or null for a row that only informs (no state to say). */
  todo: boolean | null;
  href: string;
  action: string;
}

type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "failed" | "forbidden" };
const failed = { ok: false as const, reason: "failed" as const };

/** Today's work, one row each: what it is, where it stands in words, and the page to act on it. */
export function DayList({ rows }: { rows: readonly DayRow[] }) {
  if (rows.length === 0) return <p className={readStyles.rowMeta}>{t("dashboard.nothing")}</p>;
  return (
    <ul className={readStyles.rows}>
      {rows.map((row) => (
        <li key={row.key} className={readStyles.rowItem}>
          <div className={readStyles.rowHead}>
            <h3 className={readStyles.rowTitle}>{row.title}</h3>
            {row.todo === null ? null : <StatusWord tone={row.todo ? "warn" : "ok"}>{t(row.todo ? "coord.status.todo" : "coord.status.done")}</StatusWord>}
          </div>
          <div className={readStyles.rowHead}>
            <p className={readStyles.rowMeta}>{row.meta}</p>
            <OpenLink href={row.href} label={`${row.action}: ${row.title}`} text={row.action} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Home({ art, title, subtitle, dayBs, view, onRetry, tiles, children }: { art: ArtCode; title: string; subtitle: string; dayBs: string | null; view: { status: string }; onRetry: () => void; tiles: number; children: React.ReactNode }) {
  return (
    <div className={readStyles.page}>
      <ReadHeader title={title} subtitle={subtitle} dayBs={dayBs} art={art} />
      {view.status === "loading" ? <TableSkeleton rows={4} tiles={tiles} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={onRetry} /> : null}
      {children}
    </div>
  );
}

function scopeOf(claim: RoleClaim | undefined, sectionName: (key: string | null | undefined) => string) {
  if (!claim || claim.scope === "institution") return t("portal.scopeInstitution");
  if (claim.scope === "own") return t("portal.scopeOwn");
  if (claim.scope === "assigned") return t("portal.scopeAssigned");
  return t("portal.scopeSection", { section: sectionName(claim.section) });
}

// ---------------------------------------------------------------- Accountant

export interface FeesDay {
  overdue: { students: number; paisa: number };
  duePaisa: number;
  structures: { draft: number; waiting: number; live: number };
}

export function feesFigures(d: FeesDay): Figure[] {
  return [
    { key: "overdue", icon: Scale, tone: d.overdue.students > 0 ? "bad" : "ok", value: String(d.overdue.students), label: t("home.accountant.figure.overdue") },
    { key: "due", icon: Wallet, tone: "accent", value: nprShort(d.duePaisa), label: t("home.accountant.figure.due") },
    { key: "structures", icon: FileText, tone: d.structures.waiting > 0 ? "warn" : "ok", value: String(d.structures.waiting), label: t("home.accountant.figure.waiting") },
  ];
}

export function feesRows(d: FeesDay): DayRow[] {
  return [
    { key: "overdue", title: t("home.accountant.overdue"), meta: d.overdue.students > 0 ? t("home.accountant.overdueMeta", { count: d.overdue.students, amount: nprShort(d.overdue.paisa) }) : t("home.accountant.overdueNone"), todo: d.overdue.students > 0, href: "/portal/fees/dues", action: t("dashboard.open") },
    {
      key: "structures",
      title: t("home.accountant.structures"),
      meta: t("home.accountant.structuresMeta", { live: d.structures.live, waiting: d.structures.waiting, draft: d.structures.draft }),
      todo: d.structures.draft > 0,
      href: "/portal/fees/structures",
      action: t("dashboard.open"),
    },
  ];
}

/** The Accountant's home (D-107): what is waiting on them in fees, and what they can do. */
export function AccountantDashboard() {
  const { api, me } = useSession();
  const { config, term, moduleEnabled } = useConfig();
  const feesOn = moduleEnabled("fees");
  const [now] = useState(() => new Date());
  const loadNow = useCallback(async (): Promise<Loaded<FeesDay | null>> => {
    if (!feesOn) return { ok: true, data: null };
    const [dues, structures] = await Promise.all([loadDues(api), loadStructures(api)]);
    if (!dues.ok || !structures.ok) return failed;
    const overdue = dues.data.students.filter((s) => s.overduePaisa > 0);
    const count = (status: "draft" | "waiting" | "live") => structures.data.structures.filter((s) => s.status === status).length;
    return {
      ok: true,
      data: {
        overdue: { students: overdue.length, paisa: dues.data.totals.overduePaisa },
        duePaisa: dues.data.totals.duePaisa,
        structures: { draft: count("draft"), waiting: count("waiting"), live: count("live") },
      },
    };
  }, [api, feesOn]);
  const { view, reload } = useLoad<FeesDay | null>(loadNow);
  if (!me) return null;
  const claim = me.roles.find((r) => r.role === "accountant");
  const scope = scopeOf(claim, (key) => config?.sections.find((s) => s.key === key)?.name ?? key ?? "");
  const day = view.status === "ready" ? view.data : null;
  return (
    <Home art={OVERVIEW_ART.accountant} title={t(greetingKey(now), { name: me.name })} subtitle={`${term("role.accountant")} · ${scope}`} dayBs={null} view={view} onRetry={() => void reload()} tiles={4}>
      {day ? (
        <>
          <FigureTiles figures={feesFigures(day)} label={t("home.accountant.figures")} />
          <Panel title={t("coord.today.title")} labelledBy="accountant-today">
            <DayList rows={feesRows(day)} />
          </Panel>
        </>
      ) : null}
      <RoleBriefLinks role="accountant" />
    </Home>
  );
}
