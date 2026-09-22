"use client";

import { useCallback, useState } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Badge, Button, Notice, TextArea } from "@/ui";

import styles from "./admissions.module.css";
import { ClassPicker } from "./ClassPicker";
import { approveApplication, loadApplication, loadQueue, rejectApplication, requestChanges } from "./client";
import { STATUS_LABEL, type ApplicationDetail, type ApplicationSummary } from "./model";

/** The Co-ordinator's queue: applications waiting on a decision, oldest first (D-063). */
export function QueueScreen() {
  const { api } = useSession();
  const loadNow = useCallback(() => loadQueue(api), [api]);
  const { view, reload } = useLoad(loadNow);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <h1 className={setupStyles.title}>{t("admissions.queue.title")}</h1>
      <p className={setupStyles.muted}>{t("admissions.queue.intro")}</p>
      <Gate view={view} onRetry={() => void reload()}>
        {(applications) =>
          applications.length === 0 ? (
            <p className={setupStyles.empty}>{t("admissions.queue.empty")}</p>
          ) : (
            <ul className={setupStyles.list}>
              {applications.map((a) => (
                <QueueRow key={a.id} application={a} open={openId === a.id} onToggle={() => setOpenId((current) => (current === a.id ? null : a.id))} onDecided={() => void reload()} />
              ))}
            </ul>
          )
        }
      </Gate>
    </>
  );
}

export function QueueRow({ application, open, onToggle, onDecided }: { application: ApplicationSummary; open: boolean; onToggle: () => void; onDecided: () => void }) {
  return (
    <li className={setupStyles.item}>
      <div className={styles.queueItem}>
        <h2 className={setupStyles.itemTitle}>
          {application.firstName} {application.lastName}
        </h2>
        <div className={styles.queueMeta}>
          <Badge tone={application.status === "needs_changes" ? "bad" : "neutral"}>{t(STATUS_LABEL[application.status])}</Badge>
          <span>{application.sectionKey} · {application.programmeName} · {application.levelName}</span>
          {application.duplicateFlags.length > 0 ? <Badge tone="bad">{t("admissions.queue.possibleDuplicate")}</Badge> : null}
        </div>
        <Button variant="secondary" onClick={onToggle} aria-expanded={open}>
          {open ? t("admissions.queue.hide") : t("admissions.queue.review")}
        </Button>
        {open ? <ReviewPanel id={application.id} onDecided={onDecided} /> : null}
      </div>
    </li>
  );
}

function ReviewPanel({ id, onDecided }: { id: string; onDecided: () => void }) {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const result = await loadApplication(api, id);
    return result.ok ? result : { ok: false as const, reason: result.reason === "not_found" ? ("failed" as const) : result.reason };
  }, [api, id]);
  const { view, reload } = useLoad(loadNow);

  return (
    <Gate view={view} onRetry={() => void reload()}>
      {(detail) => <ReviewForm detail={detail} onDecided={onDecided} />}
    </Gate>
  );
}

function ReviewForm({ detail, onDecided }: { detail: ApplicationDetail; onDecided: () => void }) {
  const { api } = useSession();
  const [mode, setMode] = useState<"none" | "changes" | "reject" | "approve">("none");
  const [reason, setReason] = useState("");
  const [classId, setClassId] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function submitChanges() {
    if (!reason.trim()) return setFailure(t("admissions.error.reasonRequired"));
    setPending(true);
    const result = await requestChanges(api, detail.id, ["general"], reason.trim());
    setPending(false);
    if (result.ok) return onDecided();
    setFailure(t("admissions.error.failed"));
  }
  async function submitReject() {
    if (!reason.trim()) return setFailure(t("admissions.error.reasonRequired"));
    setPending(true);
    const result = await rejectApplication(api, detail.id, reason.trim());
    setPending(false);
    if (result.ok) return onDecided();
    setFailure(t("admissions.error.failed"));
  }
  async function submitApprove() {
    if (!classId.trim()) return setFailure(t("admissions.error.classRequired"));
    setPending(true);
    const result = await approveApplication(api, detail.id, classId.trim(), null);
    setPending(false);
    if (result.ok) return onDecided();
    setFailure(result.reason === "invalid" ? result.message : t("admissions.error.failed"));
  }

  return (
    <div className={setupStyles.form}>
      {failure ? <Notice tone="bad">{failure}</Notice> : null}
      <div className={styles.detailGrid}>
        <div>
          <p className={styles.detailLabel}>{t("admissions.field.dob")}</p>
          <p className={styles.detailValue}>{detail.dobBs ?? detail.dob}</p>
        </div>
        <div>
          <p className={styles.detailLabel}>{t("admissions.field.phone")}</p>
          <p className={styles.detailValue}>{detail.phone}</p>
        </div>
        <div>
          <p className={styles.detailLabel}>{t("admissions.field.email")}</p>
          <p className={styles.detailValue}>{detail.email}</p>
        </div>
        <div>
          <p className={styles.detailLabel}>{t("admissions.field.guardianName")}</p>
          <p className={styles.detailValue}>
            {detail.guardianName} ({detail.guardianPhone})
          </p>
        </div>
        {detail.previousSchool ? (
          <div>
            <p className={styles.detailLabel}>{t("admissions.field.previousSchool")}</p>
            <p className={styles.detailValue}>{detail.previousSchool}</p>
          </div>
        ) : null}
        {detail.referredBy ? (
          <div>
            <p className={styles.detailLabel}>{t("admissions.field.referredBy")}</p>
            <p className={styles.detailValue}>{detail.referredBy}</p>
          </div>
        ) : null}
      </div>

      <div className={styles.decideActions}>
        <Button variant="secondary" disabled={pending} onClick={() => setMode(mode === "changes" ? "none" : "changes")}>
          {t("admissions.decide.requestChanges")}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => setMode(mode === "reject" ? "none" : "reject")}>
          {t("admissions.decide.reject")}
        </Button>
        <Button disabled={pending} onClick={() => setMode(mode === "approve" ? "none" : "approve")}>
          {t("admissions.decide.approve")}
        </Button>
      </div>

      {mode === "changes" || mode === "reject" ? (
        <>
          <TextArea label={t("admissions.decide.reasonLabel")} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          <Button loading={pending} onClick={() => void (mode === "changes" ? submitChanges() : submitReject())}>
            {t(mode === "changes" ? "admissions.decide.sendChanges" : "admissions.decide.confirmReject")}
          </Button>
        </>
      ) : null}
      {mode === "approve" ? (
        <>
          <p className={setupStyles.muted}>{t("admissions.decide.classHint")}</p>
          <ClassPicker levelId={detail.levelId} value={classId} onChange={setClassId} />
          <Button loading={pending} disabled={!classId} onClick={() => void submitApprove()}>
            {t("admissions.decide.confirmApprove")}
          </Button>
        </>
      ) : null}
    </div>
  );
}

