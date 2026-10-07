"use client";

import { ArrowLeft, Check, ChevronRight, CircleAlert, FileText, Inbox, Info, Percent, ReceiptText, Undo2, Wallet, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { FormattedText } from "@/content/FormattedText";
import { formatBsDate } from "@/content/model";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { Button, HeroBand, Illustration, Notice, Select, Skeleton, TextArea } from "@/ui";

import styles from "./approvals.module.css";
import { approve, decline, loadInbox, loadReview, withdraw } from "./client";
import {
  KINDS,
  KIND_FILTER_LABEL,
  cardLines,
  confirmSubject,
  contentKindLabel,
  countByKind,
  discountReason,
  effectLines,
  feeAmount,
  initials,
  kindLabel,
  npr,
  paymentMethod,
  visibleRequests,
  type ApprovalDetail,
  type ApprovalKind,
  type ApprovalReview,
  type ApprovalSummary,
  type Sort,
} from "./model";

/**
 * The Principal's decision inbox (D-102, after the PM's reference design): scan the cards, open one to review it at the
 * side, confirm, decide. One prominent button per view (D-030): the cards offer Review; the panel offers Approve request.
 * Every decision is the server's: a request that changed since it was sent (stale) cannot be approved, a request someone
 * else decided first says so (admin FUT F-07), and the Principal's own request is theirs to take back, not to decide
 * (F-13). Status is always said in words.
 */

const KIND_ICON: Record<ApprovalKind, { icon: LucideIcon; tone: "accent" | "ok" | "bad" | "warn" }> = {
  website_content: { icon: FileText, tone: "ok" },
  fee_structure: { icon: ReceiptText, tone: "accent" },
  discount: { icon: Percent, tone: "bad" },
  reversal: { icon: Undo2, tone: "warn" },
  refund: { icon: Wallet, tone: "accent" },
};

function KindTile({ kind }: { kind: ApprovalKind }) {
  const { icon: Icon, tone } = KIND_ICON[kind];
  return (
    <span className={styles.tile} data-tone={tone} aria-hidden>
      <Icon strokeWidth={1.75} />
    </span>
  );
}

type StatusWord = "waiting" | "stale" | "approved" | "declined" | "withdrawn" | "mine";
const STATUS_LABEL: Record<StatusWord, MessageKey> = {
  waiting: "approvals.status.waiting",
  stale: "approvals.status.stale",
  approved: "approvals.status.approved",
  declined: "approvals.status.declined",
  withdrawn: "approvals.status.withdrawn",
  mine: "approvals.status.mine",
};
function Status({ word }: { word: StatusWord }) {
  return (
    <span className={styles.status} data-status={word}>
      {t(STATUS_LABEL[word])}
    </span>
  );
}

/** "Gita Thapa" and "Accountant", in the school's own words for the roles; the build team is "Support". */
function useRoleName(): (role: ApprovalSummary["requesterRole"]) => string {
  const { term } = useConfig();
  return (role) => (role === "super_admin" ? t("approvals.role.support") : role ? term(`role.${role}`) : "");
}

const nepalClock = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kathmandu", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
const sentOn = (request: ApprovalSummary) => (request.createdOnBs ? formatBsDate(request.createdOnBs) : request.createdAt.slice(0, 10));

// --- The list ------------------------------------------------------------------------------------------------

export function ApprovalCard({ request, onReview }: { request: ApprovalSummary; onReview: (request: ApprovalSummary, opener: HTMLButtonElement) => void }) {
  const { subject, lines } = cardLines(request);
  const titleId = useId();
  return (
    <li>
      <article className={styles.card} aria-labelledby={titleId}>
        <KindTile kind={request.kind} />
        <div className={styles.main}>
          <h2 id={titleId} className={styles.kind}>
            {kindLabel(request.kind)}
          </h2>
          <p className={styles.subject}>{subject}</p>
          {lines.map((line, i) => (
            <p key={line} className={i === lines.length - 1 && lines.length > 1 ? styles.strong : styles.line}>
              {line}
            </p>
          ))}
        </div>
        <div className={styles.side}>
          <span className={styles.statuses}>
            <Status word="waiting" />
            {request.mine ? <Status word="mine" /> : null}
          </span>
          <p>{t("approvals.inbox.requestedBy", { name: request.requestedBy })}</p>
          <p>{sentOn(request)}</p>
        </div>
        <button type="button" className={styles.reviewButton} aria-label={t("approvals.reviewItem", { kind: kindLabel(request.kind), subject })} onClick={(event) => onReview(request, event.currentTarget)}>
          {t("approvals.review")}
          <ChevronRight aria-hidden />
        </button>
      </article>
    </li>
  );
}

/** The cards, or the calm empty state. Pure, so tests draw it without a network. */
export function ApprovalsList({ requests, filtered, onReview }: { requests: readonly ApprovalSummary[]; filtered: boolean; onReview: (request: ApprovalSummary, opener: HTMLButtonElement) => void }) {
  if (requests.length === 0)
    return (
      <div className={styles.empty} role="status">
        {filtered ? <Inbox aria-hidden strokeWidth={1.5} /> : <Illustration code="E3" size="spot" />}
        <p className={styles.emptyTitle}>{t(filtered ? "approvals.empty.filtered" : "approvals.inbox.empty")}</p>
        {filtered ? null : <p className={styles.line}>{t("approvals.empty.caughtUp")}</p>}
      </div>
    );
  return (
    <ul className={styles.list}>
      {requests.map((request) => (
        <ApprovalCard key={request.id} request={request} onReview={onReview} />
      ))}
    </ul>
  );
}

/** The shape of the cards while they load: type, title, summary, requester, date and the action area (D-030). */
export function ApprovalsSkeleton() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{t("approvals.loading")}</span>
      <ul className={styles.list} aria-hidden>
        {[0, 1, 2].map((n) => (
          <li key={n} className={styles.card}>
            <Skeleton width="3rem" height="3rem" />
            <span className={styles.main}>
              <Skeleton width="30%" height="1.2rem" />
              <Skeleton width="55%" />
              <Skeleton width="80%" />
            </span>
            <span className={styles.side}>
              <Skeleton width="5rem" />
              <Skeleton width="8rem" />
              <Skeleton width="6rem" />
            </span>
            <Skeleton width="6rem" height="2.75rem" />
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- The review panel's facts ------------------------------------------------------------------------------

function Facts({ rows, label }: { rows: { name: string; value: ReactNode; total?: boolean; wide?: boolean }[]; label?: string }) {
  return (
    <dl className={styles.facts} aria-label={label}>
      {rows.map((row) => (
        <div key={row.name} className={[styles.fact, row.total ? styles.total : "", row.wide ? styles.wide : ""].filter(Boolean).join(" ")}>
          <dt>{row.name}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-label={title}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}

/** What the request would change, for each of the five kinds (D-102). Pure. */
export function DetailBody({ detail }: { detail: ApprovalDetail }) {
  const studentRows = (d: { student: string; sid: string; className: string | null }) => [
    { name: t("approvals.detail.student"), value: `${d.student} (${d.sid})` },
    ...(d.className ? [{ name: t("approvals.detail.class"), value: d.className }] : []),
  ];
  switch (detail.kind) {
    case "fee_structure":
      return (
        <>
          <Section title={t("approvals.detail.feeItems")}>
            <Facts
              rows={[
                ...detail.items.map((item) => ({ name: item.name, value: feeAmount(item.amountPaisa, item.frequency) })),
                { name: t("approvals.detail.yearlyTotal"), value: npr(detail.yearlyTotalPaisa), total: true },
              ]}
            />
          </Section>
          <Section title={t("approvals.detail.programmeLevel")}>
            <p className={styles.subject}>{t("approvals.detail.programmeLine", { programme: detail.programme, level: detail.level, year: detail.year })}</p>
          </Section>
          <Notice>
            <span className={styles.failed}>
              <Info aria-hidden width={18} height={18} />
              {t("approvals.effect.feeStructure")}
            </span>
          </Notice>
        </>
      );
    case "website_content":
      return (
        <>
          <Section title={contentKindLabel(detail.contentKind)}>
            <p className={styles.kind}>{detail.title}</p>
          </Section>
          <Section title={t("approvals.detail.preview")}>
            <p className={styles.line}>{t("approvals.detail.previewNote")}</p>
            <div className={styles.preview}>
              <FormattedText body={detail.bodyPreview + (detail.bodyTruncated ? "…" : "")} />
            </div>
          </Section>
          {detail.publishOnBs || detail.holidayFromBs ? (
            <Facts
              rows={[
                ...(detail.publishOnBs ? [{ name: t("approvals.detail.publishOn"), value: formatBsDate(detail.publishOnBs) }] : []),
                ...(detail.holidayFromBs ? [{ name: t("approvals.detail.holiday"), value: `${formatBsDate(detail.holidayFromBs)}${detail.holidayToBs && detail.holidayToBs !== detail.holidayFromBs ? ` – ${formatBsDate(detail.holidayToBs)}` : ""}` }] : []),
              ]}
            />
          ) : null}
        </>
      );
    case "discount": {
      const reason = discountReason(detail.reason);
      return (
        <Facts
          rows={[
            ...studentRows(detail),
            ...(detail.percent ? [{ name: t("approvals.detail.discount"), value: `${detail.percent}%` }, { name: t("approvals.detail.equivalent"), value: npr(detail.amountPaisa) }] : [{ name: t("approvals.detail.discount"), value: npr(detail.amountPaisa) }]),
            ...(reason ? [{ name: t("approvals.detail.reason"), value: reason, wide: true }] : []),
            ...(detail.note ? [{ name: t("approvals.detail.note"), value: detail.note, wide: true }] : []),
          ]}
        />
      );
    }
    case "reversal": {
      const method = paymentMethod(detail.payment?.method);
      return (
        <>
          <Facts
            rows={[
              ...studentRows(detail),
              { name: t("approvals.detail.originalPayment"), value: npr(detail.payment?.amountPaisa ?? detail.amountPaisa) },
              ...(detail.payment?.paidOnBs ? [{ name: t("approvals.detail.paymentDate"), value: formatBsDate(detail.payment.paidOnBs) }] : []),
              ...(detail.payment?.receiptNumber ? [{ name: t("approvals.detail.receipt"), value: detail.payment.receiptNumber }] : []),
              ...(method ? [{ name: t("approvals.detail.method"), value: method }] : []),
              ...(detail.reason ? [{ name: t("approvals.detail.reason"), value: detail.reason, wide: true }] : []),
            ]}
          />
          <Notice>{t("approvals.effect.reversal")}</Notice>
        </>
      );
    }
    case "refund":
      return (
        <>
          <Facts
            rows={[
              ...studentRows(detail),
              { name: t("approvals.detail.credit"), value: npr(detail.availableCreditPaisa) },
              { name: t("approvals.detail.refundAmount"), value: npr(detail.amountPaisa) },
              ...(detail.note ? [{ name: t("approvals.detail.reason"), value: detail.note, wide: true }] : []),
            ]}
          />
          <Notice>{t("approvals.effect.refund")}</Notice>
        </>
      );
  }
}

function RequestedBy({ request }: { request: ApprovalSummary }) {
  const roleName = useRoleName();
  return (
    <div className={styles.people}>
      <Section title={t("approvals.detail.requestedBy")}>
        <div className={styles.person}>
          <span className={styles.avatar} aria-hidden>
            {initials(request.requestedBy)}
          </span>
          <div>
            <p>{request.requestedBy}</p>
            <p className={styles.line}>{roleName(request.requesterRole)}</p>
          </div>
        </div>
      </Section>
      <Section title={t("approvals.detail.sentOn")}>
        <p>{sentOn(request)}</p>
        <p className={styles.line}>{nepalClock(request.createdAt)}</p>
      </Section>
    </div>
  );
}

// --- The review panel ----------------------------------------------------------------------------------------

type Step = "review" | "decline" | "approved" | "declined" | "withdrawn" | "already" | "gone";

/**
 * One request, opened from its card: the native modal dialog keeps focus inside, Escape closes it, and the Review button
 * gets focus back. The panel reads the request again from the server, so a request that went stale since the list was
 * loaded says so before Approve is ever offered.
 */
function ReviewDrawer({ request, onClose }: { request: ApprovalSummary; onClose: (changed: boolean) => void }) {
  const { api } = useSession();
  const ref = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const load = useCallback(() => loadReview(api, request.id), [api, request.id]);
  const [review, setReview] = useState<{ status: "loading" } | { status: "ready"; data: ApprovalReview } | { status: "failed" }>({ status: "loading" });
  const [step, setStep] = useState<Step>("review");
  const [stale, setStale] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const changed = step !== "review" && step !== "decline";

  // What the server said about the request. The panel starts as loading; Retry sets it back before reading again.
  const show = useCallback((result: Awaited<ReturnType<typeof load>>) => {
    if (result.ok) {
      setReview({ status: "ready", data: result.data });
      if (result.data.status === "stale") setStale(true);
      else if (result.data.status !== "pending") setStep("already");
    } else if (result.reason === "not_found") setStep("gone");
    else setReview({ status: "failed" });
  }, []);
  const read = useCallback(() => load().then(show), [load, show]);

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
    let live = true;
    void load().then((result) => (live ? show(result) : undefined));
    return () => {
      live = false;
    };
  }, [load, show]);

  // Closing (the X, Escape, Done, Close) goes through the dialog's own close event, below, exactly once.
  const close = () => {
    confirmRef.current?.close();
    ref.current?.close();
  };

  async function doApprove() {
    setBusy(true);
    setProblem(null);
    const result = await approve(api, request.id);
    setBusy(false);
    confirmRef.current?.close();
    if (result.ok) return setStep("approved");
    if (result.reason === "stale") return setStale(true);
    if (result.reason === "already_decided") return setStep("already");
    setProblem(t(result.reason === "own_request" ? "approvals.error.ownRequest" : "approvals.error.approveFailed"));
  }

  async function doDecline(event: FormEvent) {
    event.preventDefault();
    const text = reason.trim();
    if (!text) return setReasonError(t("approvals.decline.required"));
    setReasonError(null);
    setBusy(true);
    setProblem(null);
    const result = await decline(api, request.id, text);
    setBusy(false);
    if (result.ok) return setStep("declined");
    if (result.reason === "stale") {
      setStep("review");
      return setStale(true);
    }
    if (result.reason === "already_decided") return setStep("already");
    setProblem(t("approvals.error.declineFailed"));
  }

  async function doWithdraw() {
    setBusy(true);
    setProblem(null);
    const result = await withdraw(api, request.id);
    setBusy(false);
    if (result.ok) return setStep("withdrawn");
    setProblem(t("approvals.error.failed"));
  }

  const detail = review.status === "ready" ? review.data.detail : null;
  const subject = confirmSubject(request, detail);
  const effect = effectLines(detail, request.kind);
  const statusWord: StatusWord = stale ? "stale" : step === "approved" ? "approved" : step === "declined" ? "declined" : "waiting";

  let body: ReactNode;
  let foot: ReactNode = null;
  if (step === "approved" || step === "declined" || step === "withdrawn" || step === "already" || step === "gone") {
    const outcome: Record<typeof step, { icon: LucideIcon; tone: "ok" | "bad"; title: MessageKey; text: string; more?: string }> = {
      approved: { icon: Check, tone: "ok", title: "approvals.outcome.approved", text: effect.done },
      declined: { icon: Check, tone: "ok", title: "approvals.outcome.declined", text: t("approvals.outcome.declinedText", { name: request.requestedBy }) },
      withdrawn: { icon: Check, tone: "ok", title: "approvals.outcome.withdrawn", text: t("approvals.outcome.withdrawnText") },
      already: { icon: CircleAlert, tone: "bad", title: "approvals.outcome.already", text: t("approvals.outcome.alreadyText"), more: t("approvals.outcome.noChange") },
      gone: { icon: CircleAlert, tone: "bad", title: "approvals.outcome.gone", text: t("approvals.outcome.goneText") },
    };
    const o = outcome[step];
    body = (
      <div className={styles.outcome} data-tone={o.tone} role="status">
        <o.icon aria-hidden />
        <h2 id={titleId}>{t(o.title)}</h2>
        <p>{o.text}</p>
        {o.more ? <p>{o.more}</p> : null}
      </div>
    );
    foot = (
      <Button fullWidth variant={step === "already" || step === "gone" ? "secondary" : "primary"} onClick={close}>
        {t(step === "already" || step === "gone" ? "approvals.close" : "approvals.done")}
      </Button>
    );
  } else if (step === "decline") {
    body = (
      <form id={`${titleId}-decline`} className={styles.section} onSubmit={(e) => void doDecline(e)} noValidate>
        <p className={styles.kind}>{t("approvals.decline.question")}</p>
        <TextArea
          label={t("approvals.decline.label")}
          placeholder={t("approvals.decline.placeholder")}
          hint={t("approvals.decline.hint")}
          value={reason}
          maxLength={500}
          rows={5}
          error={reasonError ?? undefined}
          onChange={(event) => setReason(event.target.value)}
        />
        {problem ? <Notice tone="bad">{problem}</Notice> : null}
      </form>
    );
    foot = (
      <>
        <Button type="submit" form={`${titleId}-decline`} variant="secondary" className={styles.decline} fullWidth loading={busy} loadingLabel={t("setup.working")}>
          {t("approvals.declineRequest")}
        </Button>
        <Button variant="quiet" fullWidth onClick={() => setStep("review")}>
          {t("approvals.cancel")}
        </Button>
      </>
    );
  } else if (review.status === "loading") {
    body = (
      <div role="status" aria-busy="true" className={styles.section}>
        <span className="sr-only">{t("approvals.loading")}</span>
        <Skeleton width="60%" height="1.25rem" />
        <Skeleton width="100%" height="8rem" />
        <Skeleton width="45%" />
      </div>
    );
  } else if (review.status === "failed") {
    body = (
      <Notice tone="bad">
        <span className={styles.failed}>
          {t("approvals.reviewFailed")}
          <Button
            variant="secondary"
            onClick={() => {
              setReview({ status: "loading" });
              void read();
            }}
          >
            {t("approvals.retry")}
          </Button>
        </span>
      </Notice>
    );
  } else {
    body = (
      <>
        {stale ? (
          <Notice tone="bad" title={t("approvals.stale.title")}>
            {t("approvals.error.stale")}
          </Notice>
        ) : null}
        {request.mine && !stale ? <Notice title={t("approvals.status.mine")}>{t("approvals.mine.text")}</Notice> : null}
        {detail ? <DetailBody detail={detail} /> : <p className={styles.subject}>{request.summary}</p>}
        <RequestedBy request={request} />
        {problem ? <Notice tone="bad">{problem}</Notice> : null}
      </>
    );
    foot = stale ? (
      <Button variant="quiet" fullWidth onClick={close}>
        {t("approvals.close")}
      </Button>
    ) : request.mine ? (
      <Button variant="secondary" fullWidth loading={busy} loadingLabel={t("setup.working")} onClick={() => void doWithdraw()}>
        {t("approvals.mine.withdraw")}
      </Button>
    ) : (
      <>
        <Button fullWidth onClick={() => confirmRef.current?.showModal()}>
          {t("approvals.approveRequest")}
        </Button>
        <Button variant="secondary" fullWidth onClick={() => setStep("decline")}>
          {t("approvals.declineRequest")}
        </Button>
      </>
    );
  }

  return (
    <dialog ref={ref} className={styles.drawer} aria-labelledby={titleId} onClose={(event) => (event.target === ref.current ? onClose(changed || stale) : undefined)} onCancel={(e) => (busy ? e.preventDefault() : undefined)}>
      <div className={styles.drawerHead}>
        {step === "decline" ? (
          <button type="button" className={styles.iconButton} aria-label={t("approvals.back")} onClick={() => setStep("review")}>
            <ArrowLeft aria-hidden />
          </button>
        ) : (
          <KindTile kind={request.kind} />
        )}
        <div className={styles.drawerTitle}>
          {step === "decline" ? (
            <h2 id={titleId}>{t("approvals.declineRequest")}</h2>
          ) : (
            <>
              <div className={styles.titleLine}>
                {changed ? <h2>{kindLabel(request.kind)}</h2> : <h2 id={titleId}>{kindLabel(request.kind)}</h2>}
                {changed ? null : <Status word={statusWord} />}
              </div>
              <p className={styles.line}>{subject.subject}</p>
            </>
          )}
        </div>
        <button type="button" className={styles.iconButton} aria-label={t("approvals.close")} onClick={close}>
          <X aria-hidden />
        </button>
      </div>
      <div className={styles.drawerBody}>{body}</div>
      {foot ? <div className={styles.drawerFoot}>{foot}</div> : null}

      <dialog ref={confirmRef} className={styles.confirm} aria-labelledby={`${titleId}-confirm`} role="alertdialog" onCancel={(e) => (busy ? e.preventDefault() : undefined)}>
        <div className={styles.confirmBody}>
          <h2 id={`${titleId}-confirm`}>{t("approvals.confirm.title")}</h2>
          <div>
            <p className={styles.strong}>{subject.kind}</p>
            <p>{subject.subject}</p>
          </div>
          {subject.amount ? <Facts rows={[{ name: subject.amountLabel ?? "", value: subject.amount, total: true }]} /> : null}
          <p>{effect.confirm}</p>
          <p className={styles.line}>{t("approvals.confirm.final")}</p>
          <Button fullWidth loading={busy} loadingLabel={t("setup.working")} onClick={() => void doApprove()}>
            {t("approvals.approveRequest")}
          </Button>
          <Button variant="quiet" fullWidth disabled={busy} onClick={() => confirmRef.current?.close()}>
            {t("approvals.cancel")}
          </Button>
        </div>
      </dialog>
    </dialog>
  );
}

// --- The screen ----------------------------------------------------------------------------------------------

export function InboxScreen() {
  const { api } = useSession();
  const { term } = useConfig();
  const loadNow = useCallback(() => loadInbox(api), [api]);
  const { view, reload } = useLoad(loadNow);
  const [kind, setKind] = useState<ApprovalKind | null>(null);
  const [sort, setSort] = useState<Sort>("newest");
  const [open, setOpen] = useState<ApprovalSummary | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);

  const requests = view.status === "ready" ? view.data : [];
  const counts = countByKind(requests);
  const forMe = requests.filter((r) => !r.mine).length;

  return (
    <div className={styles.page}>
      <HeroBand>
        <header className={styles.header}>
          <h1 className={styles.title}>{t("approvals.inbox.title")}</h1>
          <p className={styles.intro}>{t("approvals.inbox.intro", { coordinators: term("role.coordinator"), accountants: term("role.accountant") })}</p>
          {view.status === "ready" ? (
            <p className={styles.waiting} aria-live="polite">
              {t(forMe === 1 ? "approvals.inbox.waitingOne" : "approvals.inbox.waiting", { count: forMe })}
            </p>
          ) : null}
        </header>
      </HeroBand>

      <div className={styles.toolbar}>
        <div className={styles.filters} role="group" aria-label={t("approvals.filter.label")}>
          <button type="button" className={styles.filter} aria-pressed={kind === null} onClick={() => setKind(null)}>
            {t("approvals.filter.all", { count: requests.length })}
          </button>
          {KINDS.map((k) => (
            <button key={k} type="button" className={styles.filter} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {t("approvals.filter.withCount", { label: t(KIND_FILTER_LABEL[k]), count: counts[k] })}
            </button>
          ))}
        </div>
        <div className={styles.sort}>
          <Select
            label={t("approvals.sort.label")}
            value={sort}
            onChange={(event) => setSort(event.target.value === "oldest" ? "oldest" : "newest")}
            options={[
              { value: "newest", label: t("approvals.sort.newest") },
              { value: "oldest", label: t("approvals.sort.oldest") },
            ]}
          />
        </div>
      </div>

      {view.status === "loading" ? <ApprovalsSkeleton /> : null}
      {view.status === "failed" ? (
        <Notice tone="bad">
          <span className={styles.failed}>
            {t("approvals.loadFailed")}
            <Button variant="secondary" onClick={() => void reload()}>
              {t("approvals.retry")}
            </Button>
          </span>
        </Notice>
      ) : null}
      {view.status === "forbidden" ? <Notice tone="bad">{t("approvals.inbox.forbidden")}</Notice> : null}
      {view.status === "ready" ? (
        <ApprovalsList
          requests={visibleRequests(requests, kind, sort)}
          filtered={kind !== null && requests.length > 0}
          onReview={(request, button) => {
            opener.current = button;
            setOpen(request);
          }}
        />
      ) : null}

      {open ? (
        <ReviewDrawer
          key={open.id}
          request={open}
          onClose={(changed) => {
            setOpen(null);
            if (changed) void reload();
            // Focus goes back where it came from; if that card has gone, to the page's heading area.
            requestAnimationFrame(() => (opener.current?.isConnected ? opener.current.focus() : document.querySelector<HTMLElement>("main h1")?.focus()));
          }}
        />
      ) : null}
    </div>
  );
}
