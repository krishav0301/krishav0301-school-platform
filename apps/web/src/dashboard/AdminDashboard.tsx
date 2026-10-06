"use client";

import {
  ArrowDown,
  ArrowUp,
  Banknote,
  BookOpen,
  Calendar,
  CalendarCheck,
  ChevronRight,
  ExternalLink,
  FileText,
  Globe,
  UserPlus,
  UserRoundX,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { formatNpr } from "@/fees/money";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { Button, Skeleton } from "@/ui";

import {
  attentionRows,
  bsDayMonth,
  bsLong,
  changeLabel,
  chartPoints,
  compactNpr,
  greetingKey,
  type Overview,
} from "./admin-model";
import styles from "./admin.module.css";

type Tone = "primary" | "ok" | "accent" | "warn" | "bad";

const Tile = ({ icon: Icon, tone, size = "large" }: { icon: LucideIcon; tone: Tone; size?: "large" | "small" }) => (
  <span className={styles.tile} data-tone={tone} data-size={size} aria-hidden>
    <Icon strokeWidth={1.75} />
  </span>
);

const Change = ({ percent }: { percent: number | null }) => {
  const change = changeLabel(percent);
  if (!change) return <span className={styles.muted}>{t("dashboard.kpi.noComparison")}</span>;
  const Icon = change.direction === "down" ? ArrowDown : ArrowUp;
  return (
    <span className={styles.change}>
      <span className={styles.delta} data-direction={change.direction}>
        {change.direction === "flat" ? null : <Icon aria-hidden strokeWidth={2} />}
        {change.text}
      </span>
      <span className={styles.muted}>{t("dashboard.vsLastMonth")}</span>
    </span>
  );
};

function Kpi({ href, icon, tone, label, value, foot }: { href: string; icon: LucideIcon; tone: Tone; label: MessageKey; value: string; foot: ReactNode }) {
  return (
    <Link href={href} className={`${styles.card} ${styles.kpi}`}>
      <Tile icon={icon} tone={tone} />
      <span className={styles.kpiBody}>
        <span className={styles.kpiLabel}>{t(label)}</span>
        <span className={styles.kpiValue}>{value}</span>
        <span className={styles.kpiFoot}>{foot}</span>
      </span>
      <ChevronRight className={styles.chevron} aria-hidden />
    </Link>
  );
}

// --- Institution at a glance ------------------------------------------------------------------------

function AttendanceChart({ trend }: { trend: Overview["attendance"]["trend"] }) {
  const W = 480;
  const H = 200;
  const PAD = 28;
  const points = chartPoints(
    trend.map((d) => d.percent),
    W,
    H,
    PAD,
  );
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const area = points.length > 0 ? `${line} L${points.at(-1)!.x},${H - PAD} L${points[0]!.x},${H - PAD} Z` : "";
  return (
    // The view starts left of 0 so "100%", drawn to the left of the axis, is never cut (admin FUT F-05).
    <svg viewBox={`-18 0 ${W + 18} ${H + 18}`} className={styles.chart} role="img" aria-label={trend.map((d) => `${bsDayMonth(d.dateBs)} ${d.percent ?? "–"}%`).join(", ")}>
      {[100, 80, 60, 40].map((v) => {
        const y = PAD + ((100 - v) / 60) * (H - 2 * PAD);
        return (
          <g key={v}>
            <line x1={PAD} x2={W - 4} y1={y} y2={y} className={styles.gridLine} />
            <text x={PAD - 6} y={y + 4} className={styles.axis} textAnchor="end">
              {v}%
            </text>
          </g>
        );
      })}
      {area ? <path d={area} className={styles.area} /> : null}
      {line ? <path d={line} className={styles.line} /> : null}
      {points.map((p, i) => (
        <g key={trend[i]!.date}>
          <circle cx={p.x} cy={p.y} r={4} className={styles.dot} />
          {p.value !== null ? (
            <text x={p.x} y={p.y - 10} className={styles.pointLabel} textAnchor="middle">
              {p.value}%
            </text>
          ) : null}
          <text x={p.x} y={H + 12} className={styles.axis} textAnchor="middle">
            {bsDayMonth(trend[i]!.dateBs)}
          </text>
        </g>
      ))}
    </svg>
  );
}

const Bar = ({ label, percent }: { label: string; percent: number | null }) => (
  <li className={styles.barRow}>
    <span className={styles.barLabel}>{label}</span>
    <span className={styles.barTrack} aria-hidden>
      <span className={styles.barFill} style={{ inlineSize: `${percent ?? 0}%` }} />
    </span>
    <span className={styles.barValue}>{percent === null ? t("dashboard.glance.notMarkedToday") : `${percent}%`}</span>
  </li>
);

type TabId = "attendance" | "programmes" | "fees" | "results";
const TABS: { id: TabId; label: MessageKey }[] = [
  { id: "attendance", label: "dashboard.glance.attendance" },
  { id: "programmes", label: "dashboard.glance.programmes" },
  { id: "fees", label: "dashboard.glance.fees" },
  { id: "results", label: "dashboard.glance.results" },
];

function Glance({ o }: { o: Overview }) {
  const [tab, setTab] = useState<TabId>("attendance");
  const base = useId();
  const onKey = (event: KeyboardEvent) => {
    const i = TABS.findIndex((x) => x.id === tab);
    const next = event.key === "ArrowRight" ? (i + 1) % TABS.length : event.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : null;
    if (next === null) return;
    event.preventDefault();
    setTab(TABS[next]!.id);
    document.getElementById(`${base}-tab-${TABS[next]!.id}`)?.focus();
  };
  return (
    <section className={`${styles.card} ${styles.glance}`} aria-labelledby={`${base}-title`}>
      <div className={styles.cardHead}>
        <h2 id={`${base}-title`} className={styles.cardTitle}>
          {t("dashboard.glance.title")}
        </h2>
        <span className={styles.muted}>{t("dashboard.glance.period")}</span>
      </div>
      <div role="tablist" className={styles.tabs} onKeyDown={onKey}>
        {TABS.map((x) => (
          <button
            key={x.id}
            id={`${base}-tab-${x.id}`}
            role="tab"
            type="button"
            aria-selected={tab === x.id}
            aria-controls={`${base}-panel`}
            tabIndex={tab === x.id ? 0 : -1}
            className={styles.tab}
            onClick={() => setTab(x.id)}
          >
            {t(x.label)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${tab}`} className={styles.panel}>
        {tab === "attendance" ? <AttendanceTab o={o} /> : null}
        {tab === "programmes" ? <ProgrammesTab o={o} /> : null}
        {tab === "fees" ? <FeesTab o={o} /> : null}
        {tab === "results" ? <ResultsTab o={o} /> : null}
      </div>
    </section>
  );
}

function AttendanceTab({ o }: { o: Overview }) {
  if (o.attendance.trend.length === 0 && o.attendance.byProgramme.length === 0) return <p className={styles.empty}>{t("dashboard.glance.noAttendance")}</p>;
  return (
    <div className={styles.split}>
      <div>
        <h3 className={styles.subTitle}>{t("dashboard.glance.overall")}</h3>
        {o.attendance.trend.length > 0 ? <AttendanceChart trend={o.attendance.trend} /> : <p className={styles.empty}>{t("dashboard.glance.noAttendance")}</p>}
      </div>
      <div>
        <h3 className={styles.subTitle}>{t("dashboard.glance.byProgramme")}</h3>
        <ul className={styles.bars}>
          {o.attendance.byProgramme.map((p) => (
            <Bar key={p.id} label={p.name} percent={p.percent} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function ProgrammesTab({ o }: { o: Overview }) {
  if (o.programmes.length === 0) return <p className={styles.empty}>{t("dashboard.glance.noProgrammes")}</p>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t("dashboard.glance.programme")}</th>
            <th scope="col">{t("dashboard.glance.classes")}</th>
            <th scope="col">{t("dashboard.glance.students")}</th>
            <th scope="col">{t("dashboard.glance.teachers")}</th>
          </tr>
        </thead>
        <tbody>
          {o.programmes.map((p) => (
            <tr key={p.id}>
              <th scope="row">
                {p.name}
                <span className={styles.rowNote}>{p.active ? p.sectionName : t("dashboard.glance.off")}</span>
              </th>
              <td>{p.classes}</td>
              <td>{p.students}</td>
              <td>{p.teachers}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FeesTab({ o }: { o: Overview }) {
  const items: [MessageKey, number][] = [
    ["dashboard.glance.charged", o.fees.chargedPaisa],
    ["dashboard.glance.collected", o.fees.paidPaisa],
    ["dashboard.glance.due", o.fees.duePaisa],
    ["dashboard.glance.overdue", o.fees.overduePaisa],
  ];
  return (
    <dl className={styles.figures}>
      {items.map(([label, paisa]) => (
        <div key={label} className={styles.figure}>
          <dt className={styles.muted}>{t(label)}</dt>
          <dd className={styles.figureValue}>{t("dashboard.npr", { amount: formatNpr(paisa) })}</dd>
        </div>
      ))}
    </dl>
  );
}

function ResultsTab({ o }: { o: Overview }) {
  if (o.results.publications === 0) return <p className={styles.empty}>{t("dashboard.glance.noResults")}</p>;
  return (
    <>
      <p className={styles.muted}>{t("dashboard.glance.published", { count: o.results.publications })}</p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t("dashboard.glance.programme")}</th>
              <th scope="col">{t("dashboard.glance.cards")}</th>
              <th scope="col">{t("dashboard.glance.passRate")}</th>
              <th scope="col">{t("dashboard.glance.average")}</th>
            </tr>
          </thead>
          <tbody>
            {o.results.byProgramme.map((p) => (
              <tr key={p.id}>
                <th scope="row">{p.name}</th>
                <td>{p.cards}</td>
                <td>{p.passPercent === null ? "–" : `${p.passPercent}%`}</td>
                <td>
                  {p.avgPercentHundredths !== null ? t("dashboard.glance.percent", { percent: (p.avgPercentHundredths / 100).toFixed(1) }) : "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// --- Attention, actions, website, activity ----------------------------------------------------------

const ATTENTION_ICON: Record<string, LucideIcon> = { approvals: FileText, fees: Banknote, attendance: UserRoundX, website: Globe };

function Attention({ o }: { o: Overview }) {
  const rows = attentionRows(o);
  return (
    <section className={`${styles.card} ${styles.attention}`} aria-labelledby="attention-title">
      <div className={styles.cardHead}>
        <h2 id="attention-title" className={styles.cardTitle}>
          {t("dashboard.attention.title")}
        </h2>
        {rows.length > 0 ? (
          <Link href={rows[0]!.href} className={styles.link}>
            {t("dashboard.attention.viewAll")}
          </Link>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <div className={styles.caughtUp}>
          <p className={styles.caughtUpTitle}>{t("dashboard.attention.caughtUp")}</p>
          <p className={styles.muted}>{t("dashboard.attention.caughtUpDetail")}</p>
        </div>
      ) : (
        <ul className={styles.attentionList}>
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={r.href} className={styles.attentionRow} data-tone={r.tone}>
                <Tile icon={ATTENTION_ICON[r.id]!} tone={r.tone} size="small" />
                <span className={styles.attentionText}>
                  <span className={styles.attentionTitle}>
                    <span className={styles.count} data-tone={r.tone}>
                      {r.count}
                    </span>{" "}
                    {t(r.title)}
                  </span>
                  <span className={styles.muted}>{t(r.detail)}</span>
                </span>
                <ChevronRight className={styles.chevron} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const ACTIONS: { href: string; icon: LucideIcon; tone: Tone; title: MessageKey; detail: MessageKey }[] = [
  { href: "/portal/people?add=coordinator", icon: UserPlus, tone: "primary", title: "dashboard.actions.coordinator", detail: "dashboard.actions.coordinatorDetail" },
  { href: "/portal/people?add=accountant", icon: UserPlus, tone: "ok", title: "dashboard.actions.accountant", detail: "dashboard.actions.accountantDetail" },
  { href: "/portal/content?new=post", icon: FileText, tone: "accent", title: "dashboard.actions.post", detail: "dashboard.actions.postDetail" },
  { href: "/portal/setup/programmes?add=1", icon: BookOpen, tone: "warn", title: "dashboard.actions.programme", detail: "dashboard.actions.programmeDetail" },
];

function QuickActions() {
  return (
    <section className={`${styles.card} ${styles.actionsCard}`} aria-labelledby="actions-title">
      <h2 id="actions-title" className={styles.cardTitle}>
        {t("dashboard.actions.title")}
      </h2>
      <ul className={styles.actions}>
        {ACTIONS.map((a) => (
          <li key={a.title}>
            <Link href={a.href} className={styles.action} data-tone={a.tone}>
              <a.icon aria-hidden strokeWidth={1.75} className={styles.actionIcon} />
              <span className={styles.actionTitle}>{t(a.title)}</span>
              <span className={styles.actionDetail}>{t(a.detail)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kathmandu", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

function Website({ o }: { o: Overview }) {
  const host = o.website.origin ? o.website.origin.replace(/^https?:\/\//, "") : null;
  return (
    <section className={`${styles.card} ${styles.website}`} aria-labelledby="website-title">
      <div className={styles.cardHead}>
        <h2 id="website-title" className={styles.cardTitle}>
          {t("dashboard.website.title")}
        </h2>
        <Link href="/portal/content" className={styles.link}>
          {t("dashboard.website.manage")}
        </Link>
      </div>
      <p className={styles.siteState}>
        <span className={styles.liveDot} data-live={o.website.live > 0} aria-hidden />
        <span className={styles.siteStateText}>{o.website.live > 0 ? t("dashboard.website.published") : t("dashboard.website.nothingLive")}</span>
      </p>
      {o.website.origin && host ? (
        <a href={o.website.origin} className={styles.siteLink} target="_blank" rel="noreferrer">
          {host} <ExternalLink aria-hidden className={styles.inlineIcon} />
        </a>
      ) : null}
      <dl className={styles.siteFacts}>
        <div className={styles.siteFact}>
          <Calendar aria-hidden className={styles.factIcon} />
          <span>
            <dt className={styles.muted}>{t("dashboard.website.lastUpdated")}</dt>
            <dd>{o.website.lastPublishedAt ? when(o.website.lastPublishedAt) : t("dashboard.website.never")}</dd>
          </span>
        </div>
        <div className={styles.siteFact}>
          <FileText aria-hidden className={styles.factIcon} />
          <span>
            <dt>{t("dashboard.website.drafts", { count: o.website.drafts })}</dt>
            <dd className={styles.muted}>{t("dashboard.website.awaiting")}</dd>
          </span>
        </div>
      </dl>
    </section>
  );
}

// --- The page ----------------------------------------------------------------------------------------

function Loading() {
  return (
    <div role="status" aria-busy="true" className={styles.page}>
      <span className="sr-only">{t("dashboard.loading")}</span>
      <div className={styles.kpis} aria-hidden>
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className={`${styles.card} ${styles.kpi}`}>
            <Skeleton width="3.5rem" height="3.5rem" />
            <span className={styles.kpiBody}>
              <Skeleton width="50%" />
              <Skeleton width="40%" height="2rem" />
              <Skeleton width="70%" />
            </span>
          </div>
        ))}
      </div>
      <div className={styles.rowMain} aria-hidden>
        <div className={styles.card}>
          <Skeleton width="40%" height="1.5rem" />
          <Skeleton width="100%" height="12rem" />
        </div>
        <div className={styles.card}>
          <Skeleton width="50%" height="1.5rem" />
          {[0, 1, 2, 3].map((n) => (
            <Skeleton key={n} width="100%" height="3.5rem" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function AdminDashboardView({ o, name, now }: { o: Overview; name: string; now: Date }) {
  return (
    <div className={styles.page}>
      <header className={styles.greeting}>
        <h1 className={styles.hello}>{t(greetingKey(now), { name })}</h1>
        <p className={styles.today}>
          <span>{bsLong(o.todayBs)}</span>
        </p>
      </header>

      <div className={styles.kpis}>
        <Kpi href="/portal/admissions" icon={Users} tone="primary" label="dashboard.kpi.students" value={o.students.total.toLocaleString("en-IN")} foot={<Change percent={o.students.changePercent} />} />
        <Kpi href="/portal/people" icon={UsersRound} tone="accent" label="dashboard.kpi.staff" value={o.staff.total.toLocaleString("en-IN")} foot={<Change percent={o.staff.changePercent} />} />
        <Kpi
          href="/portal/attendance"
          icon={CalendarCheck}
          tone="ok"
          label="dashboard.kpi.attendance"
          value={o.attendance.percent === null ? "–" : `${o.attendance.percent}%`}
          foot={
            <span className={styles.muted}>
              {o.attendance.marked === 0 ? t("dashboard.kpi.notMarked") : t("dashboard.kpi.present", { present: o.attendance.present.toLocaleString("en-IN"), total: o.attendance.marked.toLocaleString("en-IN") })}
            </span>
          }
        />
        <Kpi href="/portal/fees/dues" icon={Banknote} tone="warn" label="dashboard.kpi.fees" value={t("dashboard.npr", { amount: compactNpr(o.fees.collectedPaisa) })} foot={<Change percent={o.fees.changePercent} />} />
      </div>

      <div className={styles.rowMain}>
        <Glance o={o} />
        <Attention o={o} />
      </div>

      <div className={styles.rowSecond}>
        <QuickActions />
        <Website o={o} />
      </div>

    </div>
  );
}

/** The Principal's dashboard (D-088): fetched once, again when the page comes back into view, and on retry. */
export function AdminDashboard() {
  const { api, me } = useSession();
  const { term } = useConfig();
  const loadNow = useCallback(async (): Promise<{ ok: true; data: { overview: Overview; now: Date } } | { ok: false; reason: "failed" }> => {
    try {
      const { data } = await api.GET("/api/dashboard/overview");
      return data ? { ok: true, data: { overview: data, now: new Date() } } : { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  }, [api]);
  const { view, reload } = useLoad(loadNow);

  useEffect(() => {
    const again = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [reload]);

  if (view.status === "loading") return <Loading />;
  if (view.status !== "ready") {
    return (
      <div className={`${styles.card} ${styles.failed}`} role="alert">
        <p>{t("dashboard.loadFailed")}</p>
        <Button variant="secondary" onClick={() => void reload()}>
          {t("dashboard.retry")}
        </Button>
      </div>
    );
  }
  const isSupport = me?.roles.some((r) => r.role === "super_admin") && !me.roles.some((r) => r.role === "admin");
  return <AdminDashboardView o={view.data.overview} now={view.data.now} name={isSupport ? t("portal.support") : term("role.admin")} />;
}
