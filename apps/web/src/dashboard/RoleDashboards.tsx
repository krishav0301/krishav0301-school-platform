"use client";

import { CalendarCheck, ClipboardCheck, FileText, NotebookPen, PenLine, Receipt, Scale, Wallet } from "lucide-react";
import { useCallback, useState } from "react";

import { loadOwnClass, loadOwnStudent, type OwnClass } from "@/admissions/client";
import { loadClasses, loadOwn } from "@/attendance/client";
import type { OwnAttendance } from "@/attendance/model";
import { loadMyToday, loadOwnActivity, loadStudentAssignments, loadTeacherAssignments } from "@/classwork/client";
import { useConfig } from "@/config/ConfigProvider";
import { formatBsDate } from "@/content/model";
import { loadDues, loadOwnAccount, loadStructures, loadVouchers } from "@/fees/client";
import { nprShort } from "@/fees/ReadFees";
import { t } from "@/i18n/messages";
import { Facts } from "@/read/SidePanel";
import { FigureTiles, OpenLink, Panel, ReadFailure, ReadHeader, ReadTable, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { OVERVIEW_ART, type ArtCode } from "@/ui";
import { loadMySheets, loadOwnResults } from "@/results/client";
import { scoreText } from "@/results/model";
import { useSession, type RoleClaim } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";

import { bsLong, greetingKey } from "./admin-model";
import { RoleBriefLinks } from "./RoleBrief";

/**
 * The homes of the Teacher, the Student and the Accountant (D-107), on the Co-ordinator's pattern (D-106): a greeting,
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
const ofTotal = (done: number, total: number) => t("coord.ofTotal", { done, total });
const bsDay = (bs: string | null, ad: string) => (bs ? formatBsDate(bs) : ad);

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

// ---------------------------------------------------------------- Teacher

/** What a teacher's day needs; null where a module is off or the teacher has no part in it. */
export interface TeachingDay {
  todayBs: string | null;
  /** The classes this teacher is Class Teacher of, with today's register. */
  registers: { id: string; name: string; marked: boolean; absent: number }[] | null;
  logs: { written: number; total: number };
  toReview: number | null;
  drafts: number | null;
}

export function teachingFigures(d: TeachingDay): Figure[] {
  const figures: Figure[] = [];
  if (d.registers && d.registers.length > 0) {
    const marked = d.registers.filter((r) => r.marked).length;
    figures.push({ key: "registers", icon: CalendarCheck, tone: marked < d.registers.length ? "warn" : "ok", value: ofTotal(marked, d.registers.length), label: t("home.teacher.figure.registers") });
  }
  if (d.logs.total > 0) figures.push({ key: "logs", icon: PenLine, tone: d.logs.written < d.logs.total ? "warn" : "ok", value: ofTotal(d.logs.written, d.logs.total), label: t("home.teacher.figure.logs") });
  if (d.toReview !== null) figures.push({ key: "review", icon: NotebookPen, tone: d.toReview > 0 ? "warn" : "ok", value: String(d.toReview), label: t("home.teacher.figure.review") });
  if (d.drafts !== null) figures.push({ key: "drafts", icon: ClipboardCheck, tone: d.drafts > 0 ? "accent" : "ok", value: String(d.drafts), label: t("home.teacher.figure.drafts") });
  return figures;
}

export function teachingRows(d: TeachingDay): DayRow[] {
  const rows: DayRow[] = [];
  for (const r of d.registers ?? []) {
    rows.push({
      key: `register-${r.id}`,
      title: t("home.teacher.register", { name: r.name }),
      meta: r.marked ? t("dashboard.register.done", { absent: r.absent }) : t("dashboard.register.todo"),
      todo: !r.marked,
      href: "/portal/attendance",
      action: r.marked ? t("dashboard.open") : t("dashboard.register.mark"),
    });
  }
  if (d.logs.total > 0) {
    rows.push({ key: "logs", title: t("coord.today.logs"), meta: t("home.teacher.logsMeta", { written: d.logs.written, total: d.logs.total }), todo: d.logs.written < d.logs.total, href: "/portal/classwork", action: d.logs.written < d.logs.total ? t("dashboard.activity.write") : t("dashboard.open") });
  }
  if (d.toReview !== null) {
    rows.push({ key: "homework", title: t("home.teacher.homework"), meta: d.toReview > 0 ? t("home.teacher.homeworkWaiting", { count: d.toReview }) : t("home.teacher.homeworkNone"), todo: d.toReview > 0, href: "/portal/classwork/homework", action: d.toReview > 0 ? t("dashboard.homework.review") : t("dashboard.open") });
  }
  if (d.drafts !== null) {
    rows.push({ key: "marks", title: t("coord.today.marks"), meta: d.drafts > 0 ? t("home.teacher.marksDraft", { count: d.drafts }) : t("home.teacher.marksNone"), todo: d.drafts > 0, href: "/portal/results", action: t("dashboard.open") });
  }
  return rows;
}

function useTeachingDay() {
  const { api } = useSession();
  const { moduleEnabled } = useConfig();
  const attendanceOn = moduleEnabled("attendance");
  const homeworkOn = moduleEnabled("homework");
  const resultsOn = moduleEnabled("results");
  const loadNow = useCallback(async (): Promise<Loaded<TeachingDay>> => {
    const [classes, activity, work, sheets] = await Promise.all([attendanceOn ? loadClasses(api) : null, loadMyToday(api), homeworkOn ? loadTeacherAssignments(api) : null, resultsOn ? loadMySheets(api) : null]);
    if ((classes && !classes.ok) || !activity.ok || (work && !work.ok)) return failed;
    const mine = classes?.ok ? classes.data.classes.filter((c) => c.mine) : [];
    return {
      ok: true,
      data: {
        todayBs: classes?.ok ? classes.data.todayBs : activity.data.dateBs,
        registers: mine.length > 0 ? mine.map((c) => ({ id: c.id, name: [c.programmeName, c.levelName, c.label].filter(Boolean).join(" · "), marked: c.markedToday, absent: c.absentToday })) : null,
        logs: { written: activity.data.subjects.filter((s) => s.body !== null).length, total: activity.data.subjects.length },
        toReview: work?.ok ? work.data.assignments.filter((a) => !a.withdrawn).reduce((sum, a) => sum + a.toReview + a.requests, 0) : null,
        // Mark sheets are a help here, not the page: if they cannot be read (no terminal yet), the line is left out.
        drafts: sheets?.ok && sheets.data.subjects.length > 0 ? sheets.data.subjects.flatMap((s) => s.sheets).filter((s) => s.status === "draft").length : null,
      },
    };
  }, [api, attendanceOn, homeworkOn, resultsOn]);
  return useLoad<TeachingDay>(loadNow);
}

/** The teacher's home (D-107). */
export function TeacherDashboard() {
  const { me } = useSession();
  const { term } = useConfig();
  const [now] = useState(() => new Date());
  const { view, reload } = useTeachingDay();
  if (!me) return null;
  const day = view.status === "ready" ? view.data : null;
  return (
    <Home art={OVERVIEW_ART.teacher} title={t(greetingKey(now), { name: me.name })} subtitle={`${term("role.teacher")} · ${t("portal.scopeAssigned")}`} dayBs={day?.todayBs ? bsLong(day.todayBs) : null} view={view} onRetry={() => void reload()} tiles={4}>
      {day ? (
        <>
          <FigureTiles figures={teachingFigures(day)} label={t("coord.figures")} />
          <Panel title={t("coord.today.title")} labelledBy="teacher-today">
            <DayList rows={teachingRows(day)} />
          </Panel>
        </>
      ) : null}
      <RoleBriefLinks role="teacher" />
    </Home>
  );
}

/** A Co-ordinator who also teaches sees their own teaching day under their school day. */
export function TeachingPanel() {
  const { view, reload } = useTeachingDay();
  return (
    <Panel title={t("home.teacher.yourTeaching")} labelledBy="teaching-today">
      {view.status === "loading" ? <TableSkeleton rows={3} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? <DayList rows={teachingRows(view.data)} /> : null}
    </Panel>
  );
}

// ---------------------------------------------------------------- Student

export interface StudyDay {
  record: { sid: string; className: string | null; dobBs: string | null; dob: string; guardianName: string } | null;
  /** Their class this term (FUT point 18); null when they have none in an open term. */
  cls: OwnClass | null;
  attendance: OwnAttendance | null;
  homework: { open: number; nextDue: string | null } | null;
  latestLog: string | null;
  fees: { duePaisa: number; overduePaisa: number; balancePaisa: number; chargedPaisa: number } | null;
  result: { terminal: string; score: string } | null;
}

export function studyFigures(d: StudyDay): Figure[] {
  const figures: Figure[] = [];
  if (d.attendance && d.attendance.percent !== null) figures.push({ key: "attendance", icon: CalendarCheck, tone: d.attendance.below ? "bad" : "ok", value: `${d.attendance.percent}%`, label: t("home.student.figure.attendance") });
  if (d.homework) figures.push({ key: "homework", icon: NotebookPen, tone: d.homework.open > 0 ? "warn" : "ok", value: String(d.homework.open), label: t("home.student.figure.homework") });
  if (d.fees && d.fees.chargedPaisa > 0) figures.push({ key: "fees", icon: Wallet, tone: d.fees.overduePaisa > 0 ? "bad" : d.fees.duePaisa > 0 ? "warn" : "ok", value: d.fees.duePaisa > 0 ? nprShort(d.fees.duePaisa) : t("fees.dues.clear"), label: t("home.student.figure.fees") });
  if (d.result) figures.push({ key: "result", icon: ClipboardCheck, tone: "accent", value: d.result.score, label: t("home.student.figure.result", { terminal: d.result.terminal }) });
  return figures;
}

export function studyRows(d: StudyDay): DayRow[] {
  const rows: DayRow[] = [];
  if (d.homework) {
    rows.push({
      key: "homework",
      title: t("home.student.homework"),
      meta: d.homework.open > 0 ? (d.homework.nextDue ? t("home.student.homeworkNext", { count: d.homework.open, date: d.homework.nextDue }) : t("dashboard.student.homework", { count: d.homework.open })) : t("home.student.homeworkNone"),
      todo: d.homework.open > 0,
      href: "/portal/classwork/homework",
      action: d.homework.open > 0 ? t("home.student.handIn") : t("dashboard.open"),
    });
  }
  if (d.attendance && d.attendance.percent !== null) {
    rows.push({ key: "attendance", title: t("attendance.own.title"), meta: d.attendance.below ? t("attendance.own.below", { threshold: d.attendance.threshold }) : t("attendance.own.days", { present: d.attendance.present, absent: d.attendance.absent }), todo: d.attendance.below, href: "/portal/attendance/mine", action: t("dashboard.open") });
  }
  if (d.latestLog) rows.push({ key: "log", title: t("home.student.log"), meta: t("dashboard.student.activity", { date: d.latestLog }), todo: null, href: "/portal/classwork", action: t("dashboard.read") });
  if (d.fees && d.fees.chargedPaisa > 0) {
    rows.push({
      key: "fees",
      title: t("home.student.fees"),
      meta: d.fees.overduePaisa > 0 ? t("home.student.feesOverdue", { amount: nprShort(d.fees.overduePaisa) }) : d.fees.duePaisa > 0 ? t("home.student.feesDue", { amount: nprShort(d.fees.duePaisa) }) : t("home.student.feesClear"),
      todo: d.fees.overduePaisa > 0 ? true : d.fees.duePaisa > 0 ? null : false,
      href: "/portal/fees",
      action: t("dashboard.open"),
    });
  }
  if (d.result) rows.push({ key: "result", title: t("home.student.result"), meta: t("home.student.resultMeta", { terminal: d.result.terminal }), todo: null, href: "/portal/results", action: t("dashboard.open") });
  return rows;
}

/**
 * The student's own class (FUT point 18): where it sits, its Class Teacher, each subject with who teaches it, and any
 * elective group still to choose from. Read only; the student and their parents share this view.
 */
export function OwnClassPanel({ cls }: { cls: OwnClass }) {
  const place = [cls.wing, cls.course, cls.level, cls.section ? t("home.student.class.section", { name: cls.section }) : null].filter(Boolean).join(" · ");
  return (
    <Panel title={t("home.student.class.title")} labelledBy="student-class">
      <Facts
        rows={[
          { name: t("home.student.class.class"), value: place },
          { name: t("home.student.class.term"), value: cls.termLabel },
          { name: t("home.student.class.classTeacher"), value: cls.classTeacher ?? t("home.student.class.notAssigned") },
        ]}
      />
      <ReadTable
        caption={t("home.student.class.subjects")}
        rows={cls.subjects}
        rowKey={(s) => s.name}
        columns={[
          { key: "subject", label: t("home.student.class.subject"), primary: true, cell: (s) => (s.elective ? t("home.student.class.elective", { name: s.name, group: s.elective }) : s.name) },
          { key: "teacher", label: t("home.student.class.teacher"), cell: (s) => s.teacher ?? <StatusWord>{t("home.student.class.noTeacher")}</StatusWord> },
        ]}
      />
      {cls.electivesToChoose.map((g) => (
        <p key={g.group} className={readStyles.subtitle}>
          {t("home.student.class.choose", { group: g.group, options: g.options.join(", ") })}
        </p>
      ))}
    </Panel>
  );
}

/** The student's home (D-107): their record, then what is due, then what they can do. */
export function StudentDashboard() {
  const { api, me } = useSession();
  const { moduleEnabled } = useConfig();
  const [now] = useState(() => new Date());
  const attendanceOn = moduleEnabled("attendance");
  const homeworkOn = moduleEnabled("homework");
  const feesOn = moduleEnabled("fees");
  const resultsOn = moduleEnabled("results");
  const loadNow = useCallback(async (): Promise<Loaded<StudyDay>> => {
    const [record, cls, attendance, work, activity, fees, results] = await Promise.all([
      loadOwnStudent(api),
      loadOwnClass(api),
      attendanceOn ? loadOwn(api) : null,
      homeworkOn ? loadStudentAssignments(api) : null,
      loadOwnActivity(api),
      feesOn ? loadOwnAccount(api) : null,
      resultsOn ? loadOwnResults(api) : null,
    ]);
    // No enrollment this year means no attendance, fees or record yet: those parts are left out, not shown as errors.
    if (!record.ok && record.reason !== "not_found") return failed;
    if ((work && !work.ok) || !activity.ok) return failed;
    const open = work?.ok ? work.data.assignments.filter((a) => a.submission === null || a.submission.status === "resubmit_allowed").sort((a, b) => a.dueAt.localeCompare(b.dueAt)) : [];
    const latest = results?.ok ? results.data.results[0] : undefined;
    const log = activity.data.days[0];
    return {
      ok: true,
      data: {
        record: record.ok ? { sid: record.data.sid, className: record.data.className, dobBs: record.data.dobBs, dob: record.data.dob, guardianName: record.data.guardianName } : null,
        // No class in an open term leaves the panel out; a failed read too, rather than failing the whole home.
        cls: cls.ok ? cls.data : null,
        attendance: attendance?.ok ? attendance.data : null,
        homework: work?.ok ? { open: open.length, nextDue: open[0] ? bsDay(open[0].dueDateBs, open[0].dueAt.slice(0, 10)) : null } : null,
        latestLog: log ? bsDay(log.dateBs, log.date) : null,
        fees: fees?.ok ? fees.data : null,
        result: latest ? { terminal: latest.terminalName ?? t("results.sheets.final"), score: latest.card.body.grade ?? scoreText(latest.card.body) } : null,
      },
    };
  }, [api, attendanceOn, homeworkOn, feesOn, resultsOn]);
  const { view, reload } = useLoad<StudyDay>(loadNow);
  if (!me) return null;
  const day = view.status === "ready" ? view.data : null;
  const subtitle = day?.record ? [day.record.sid, day.record.className].filter(Boolean).join(" · ") : t("portal.scopeOwn");
  return (
    <Home art={OVERVIEW_ART.student} title={t(greetingKey(now), { name: me.name })} subtitle={subtitle} dayBs={null} view={view} onRetry={() => void reload()} tiles={4}>
      {day ? (
        <>
          <FigureTiles figures={studyFigures(day)} label={t("home.student.figures")} />
          <Panel title={t("home.student.title")} labelledBy="student-today">
            <DayList rows={studyRows(day)} />
          </Panel>
          {day.cls ? <OwnClassPanel cls={day.cls} /> : null}
          {day.record ? (
            <Panel title={t("admissions.record.title")} labelledBy="student-record">
              <Facts
                rows={[
                  { name: t("admissions.record.sid"), value: day.record.sid },
                  { name: t("admissions.record.class"), value: day.record.className ?? t("admissions.record.noClass") },
                  { name: t("admissions.field.dob"), value: day.record.dobBs ? formatBsDate(day.record.dobBs) : day.record.dob },
                  { name: t("admissions.field.guardianName"), value: day.record.guardianName },
                ]}
              />
            </Panel>
          ) : null}
        </>
      ) : null}
      <RoleBriefLinks role="student" />
    </Home>
  );
}

// ---------------------------------------------------------------- Accountant

export interface FeesDay {
  vouchers: number;
  overdue: { students: number; paisa: number };
  duePaisa: number;
  structures: { draft: number; waiting: number; live: number };
}

export function feesFigures(d: FeesDay): Figure[] {
  return [
    { key: "vouchers", icon: Receipt, tone: d.vouchers > 0 ? "warn" : "ok", value: String(d.vouchers), label: t("home.accountant.figure.vouchers") },
    { key: "overdue", icon: Scale, tone: d.overdue.students > 0 ? "bad" : "ok", value: String(d.overdue.students), label: t("home.accountant.figure.overdue") },
    { key: "due", icon: Wallet, tone: "accent", value: nprShort(d.duePaisa), label: t("home.accountant.figure.due") },
    { key: "structures", icon: FileText, tone: d.structures.waiting > 0 ? "warn" : "ok", value: String(d.structures.waiting), label: t("home.accountant.figure.waiting") },
  ];
}

export function feesRows(d: FeesDay): DayRow[] {
  return [
    { key: "vouchers", title: t("home.accountant.vouchers"), meta: d.vouchers > 0 ? t("home.accountant.vouchersWaiting", { count: d.vouchers }) : t("home.accountant.vouchersNone"), todo: d.vouchers > 0, href: "/portal/fees/vouchers", action: d.vouchers > 0 ? t("home.accountant.check") : t("dashboard.open") },
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
    const [vouchers, dues, structures] = await Promise.all([loadVouchers(api), loadDues(api), loadStructures(api)]);
    if (!vouchers.ok || !dues.ok || !structures.ok) return failed;
    const overdue = dues.data.students.filter((s) => s.overduePaisa > 0);
    const count = (status: "draft" | "waiting" | "live") => structures.data.structures.filter((s) => s.status === status).length;
    return {
      ok: true,
      data: {
        vouchers: vouchers.data.vouchers.length,
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
