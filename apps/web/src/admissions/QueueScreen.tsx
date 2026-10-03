"use client";

import { ArrowLeft, CircleAlert, ClipboardList, PenLine } from "lucide-react";
import { useCallback, useState } from "react";

import { formatBsDate } from "@/content/model";
import { relativeTime } from "@/dashboard/admin-model";
import { t } from "@/i18n/messages";
import { TemporaryPasswordNotice } from "@/people/StaffScreen";
import { EmptyLine, FigureTiles, Panel, ReadFailure, ReadHeader, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { Facts, PanelSection, SidePanel } from "@/read/SidePanel";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { Button, Notice, TextArea } from "@/ui";

import styles from "./admissions.module.css";
import { ClassPicker } from "./ClassPicker";
import { approveApplication, loadApplication, loadQueue, rejectApplication, requestChanges } from "./client";
import { STATUS_LABEL, type ApplicationDetail, type ApplicationSummary } from "./model";

/** Where the application is for, in words: the section's name (never its key, Co-ordinator FUT F-05), programme, level. */
export const appliedFor = (a: Pick<ApplicationSummary, "sectionName" | "programmeName" | "levelName">) => `${a.sectionName} · ${a.programmeName} · ${a.levelName}`;

/** What a possible duplicate matched, in words. */
const DUPLICATE_WORDS: Record<string, "admissions.duplicate.phone" | "admissions.duplicate.nameDob"> = { phone: "admissions.duplicate.phone", name_dob: "admissions.duplicate.nameDob" };

/** The figures above the queue: waiting, asked for changes, and possible duplicates. Only what the list already says. */
export function queueFigures(applications: readonly ApplicationSummary[]): Figure[] {
  return [
    { key: "waiting", icon: ClipboardList, tone: "accent", value: String(applications.filter((a) => a.status === "pending_review").length), label: t("admissions.figure.waiting") },
    { key: "changes", icon: PenLine, tone: "warn", value: String(applications.filter((a) => a.status === "needs_changes").length), label: t("admissions.figure.changes") },
    { key: "duplicates", icon: CircleAlert, tone: "bad", value: String(applications.filter((a) => a.duplicateFlags.length > 0).length), label: t("admissions.figure.duplicates") },
  ];
}

/** One application in the queue: who, for where, how long it has waited, its state in words, and Review. Pure. */
export function QueueCard({ application, now, onReview }: { application: ApplicationSummary; now: Date; onReview: () => void }) {
  return (
    <li className={readStyles.rowItem}>
      <div className={readStyles.rowHead}>
        <h3 className={readStyles.rowTitle}>
          {application.firstName} {application.lastName}
        </h3>
        <span className={styles.statusLine}>
          {application.duplicateFlags.length > 0 ? <StatusWord tone="bad">{t("admissions.queue.possibleDuplicate")}</StatusWord> : null}
          <StatusWord tone={application.status === "needs_changes" ? "warn" : undefined}>{t(STATUS_LABEL[application.status])}</StatusWord>
        </span>
      </div>
      <p className={readStyles.rowMeta}>
        {appliedFor(application)} · {t(application.walkIn ? "admissions.queue.walkInAgo" : "admissions.queue.appliedAgo", { when: relativeTime(application.createdAt, now) })}
      </p>
      <div>
        <Button variant="secondary" onClick={onReview} aria-label={t("admissions.queue.reviewOf", { name: `${application.firstName} ${application.lastName}` })}>
          {t("admissions.queue.review")}
        </Button>
      </div>
    </li>
  );
}

/** The Co-ordinator's queue (D-063), redesigned in D-106 after the Approvals inbox: figures, cards, and a review panel. */
export function QueueScreen() {
  const { api } = useSession();
  const loadNow = useCallback(() => loadQueue(api), [api]);
  const { view, reload } = useLoad(loadNow);
  const [open, setOpen] = useState<ApplicationSummary | null>(null);
  const [now] = useState(() => new Date());

  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("admissions.queue.title")} subtitle={t("admissions.queue.intro")} />
      {view.status === "loading" ? <TableSkeleton rows={5} tiles={3} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? (
        view.data.length === 0 ? (
          <EmptyLine>{t("admissions.queue.empty")}</EmptyLine>
        ) : (
          <>
            <FigureTiles figures={queueFigures(view.data)} label={t("admissions.figures")} />
            <Panel>
              <ul className={readStyles.rows}>
                {view.data.map((a) => (
                  <QueueCard key={a.id} application={a} now={now} onReview={() => setOpen(a)} />
                ))}
              </ul>
            </Panel>
          </>
        )
      ) : null}
      {open ? (
        <ReviewPanel
          application={open}
          onClose={(changed) => {
            setOpen(null);
            if (changed) void reload();
          }}
        />
      ) : null}
    </div>
  );
}

type Step = "review" | "approve" | "changes" | "reject" | "admitted" | "changed" | "rejected";

/** One application, opened from its card: the facts, then one decision. Approve is the one prominent action. */
function ReviewPanel({ application, onClose }: { application: ApplicationSummary; onClose: (changed: boolean) => void }) {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const result = await loadApplication(api, application.id);
    return result.ok ? result : { ok: false as const, reason: result.reason === "not_found" ? ("failed" as const) : result.reason };
  }, [api, application.id]);
  const { view, reload } = useLoad(loadNow);
  const [step, setStep] = useState<Step>("review");
  const [reason, setReason] = useState("");
  const [classId, setClassId] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [admitted, setAdmitted] = useState<{ sid: string; password: string } | null>(null);
  const name = `${application.firstName} ${application.lastName}`;
  const done = step === "admitted" || step === "changed" || step === "rejected";

  const goTo = (next: Step) => {
    setStep(next);
    setFieldError(null);
    setFailure(null);
  };

  async function decide() {
    setFailure(null);
    if (step === "approve" && !classId) return setFieldError(t("admissions.error.classRequired"));
    if ((step === "changes" || step === "reject") && !reason.trim()) return setFieldError(t("admissions.error.reasonRequired"));
    setBusy(true);
    if (step === "approve") {
      const result = await approveApplication(api, application.id, classId, null);
      setBusy(false);
      if (result.ok) {
        setAdmitted({ sid: result.sid, password: result.temporaryPassword });
        return setStep("admitted");
      }
      return setFailure(result.reason === "invalid" ? result.message : t(result.reason === "conflict" ? "admissions.error.alreadyDecided" : "admissions.error.failed"));
    }
    const result = step === "changes" ? await requestChanges(api, application.id, ["general"], reason.trim()) : await rejectApplication(api, application.id, reason.trim());
    setBusy(false);
    // The request went through: the form closes into its outcome (Co-ordinator FUT F-01: it used to stay open).
    if (result.ok) return setStep(step === "changes" ? "changed" : "rejected");
    setFailure(t(result.reason === "conflict" ? "admissions.error.alreadyDecided" : "admissions.error.failed"));
  }

  const detail: ApplicationDetail | null = view.status === "ready" ? view.data : null;
  const back =
    step === "approve" || step === "changes" || step === "reject" ? (
      <button type="button" className={styles.iconButton} aria-label={t("admissions.decide.back")} disabled={busy} onClick={() => goTo("review")}>
        <ArrowLeft aria-hidden />
      </button>
    ) : undefined;

  let body;
  let foot = null;
  if (step === "admitted" && admitted) {
    body = (
      <>
        <Notice tone="ok">{t("admissions.decide.admitted", { name, sid: admitted.sid })}</Notice>
        <Facts rows={[{ name: t("admissions.record.sid"), value: <strong>{admitted.sid}</strong> }]} />
        <TemporaryPasswordNotice name={name} password={admitted.password} onDone={() => onClose(true)} />
      </>
    );
  } else if (step === "changed" || step === "rejected") {
    body = <Notice tone="ok">{t(step === "changed" ? "admissions.decide.changesSent" : "admissions.decide.rejected", { name })}</Notice>;
    foot = <Button onClick={() => onClose(true)}>{t("admissions.decide.done")}</Button>;
  } else if (view.status === "loading") {
    body = <TableSkeleton rows={6} />;
  } else if (!detail) {
    body = <ReadFailure status="failed" onRetry={() => void reload()} />;
  } else {
    body = (
      <>
        {failure ? <Notice tone="bad">{failure}</Notice> : null}
        {detail.duplicateFlags.length > 0 ? (
          <Notice tone="bad">
            {t("admissions.duplicate.intro")} {detail.duplicateFlags.map((f) => (DUPLICATE_WORDS[f] ? t(DUPLICATE_WORDS[f]) : f)).join(" ")}
          </Notice>
        ) : null}
        <PanelSection title={t("admissions.decide.facts")}>
          <Facts
            rows={[
              { name: t("admissions.field.level"), value: appliedFor(detail) },
              { name: t("admissions.field.dob"), value: detail.dobBs ? formatBsDate(detail.dobBs) : detail.dob },
              { name: t("admissions.field.phone"), value: detail.phone },
              { name: t("admissions.field.email"), value: detail.email },
              { name: t("admissions.field.guardianName"), value: `${detail.guardianName} (${detail.guardianPhone})` },
              ...(detail.previousSchool ? [{ name: t("admissions.field.previousSchool"), value: detail.previousSchool }] : []),
              ...(detail.referredBy ? [{ name: t("admissions.field.referredBy"), value: detail.referredBy }] : []),
            ]}
          />
        </PanelSection>
        {step === "approve" ? (
          <PanelSection title={t("admissions.decide.placeIn")}>
            <ClassPicker
              levelId={detail.levelId}
              value={classId}
              onChange={(id) => {
                setClassId(id);
                setFieldError(null);
              }}
            />
            {fieldError ? <p className={styles.fieldError}>{fieldError}</p> : null}
          </PanelSection>
        ) : null}
        {step === "changes" || step === "reject" ? (
          <TextArea
            label={t(step === "changes" ? "admissions.decide.changesLabel" : "admissions.decide.rejectLabel")}
            value={reason}
            rows={4}
            error={fieldError ?? undefined}
            onChange={(e) => {
              setReason(e.target.value);
              setFieldError(null);
            }}
          />
        ) : null}
      </>
    );
    foot =
      step === "review" ? (
        <>
          <Button fullWidth onClick={() => goTo("approve")}>
            {t("admissions.decide.approve")}
          </Button>
          <div className={styles.footRow}>
            <Button variant="secondary" onClick={() => goTo("changes")}>
              {t("admissions.decide.requestChanges")}
            </Button>
            <Button variant="quiet" onClick={() => goTo("reject")}>
              {t("admissions.decide.reject")}
            </Button>
          </div>
        </>
      ) : (
        <Button fullWidth loading={busy} loadingLabel={t("setup.working")} onClick={() => void decide()}>
          {t(step === "approve" ? "admissions.decide.confirmApprove" : step === "changes" ? "admissions.decide.sendChanges" : "admissions.decide.confirmReject")}
        </Button>
      );
  }

  return (
    <SidePanel
      title={name}
      subtitle={appliedFor(application)}
      status={done ? undefined : <StatusWord tone={application.status === "needs_changes" ? "warn" : undefined}>{t(STATUS_LABEL[application.status])}</StatusWord>}
      lead={back}
      busy={busy}
      onClose={() => onClose(done)}
      foot={foot}
    >
      {body}
    </SidePanel>
  );
}
