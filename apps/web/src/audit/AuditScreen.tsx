"use client";

import Link from "next/link";
import { useCallback, useState, type FormEvent, type ReactNode } from "react";

import { formatBsDate } from "@/content/model";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { useLoad } from "@/setup/useLoad";
import { Badge, Button, Field, Notice, Select, Skeleton } from "@/ui";

import styles from "./audit.module.css";
import { AREAS, loadAuditTrail, loadSignIns, type Area, type AuditTrail, type SignInLog } from "./client";

/**
 * The Principal's Audit trail and Sign-ins (CLAUDE.md section 6, D-102, admin FUT F-11): read only, newest first, in
 * pages of 25. Reached from Reports, so the menu stays as it is. The build team shows as "Support".
 */

const AREA_LABEL: Record<Area, MessageKey> = {
  people: "audit.area.people",
  structure: "audit.area.structure",
  admissions: "audit.area.admissions",
  daily: "audit.area.daily",
  fees: "audit.area.fees",
  results: "audit.area.results",
  approvals: "audit.area.approvals",
  website: "audit.area.website",
};

const SIGN_IN_REASON: Record<string, MessageKey> = {
  bad_password: "audit.signIn.reason.bad_password",
  unknown_user: "audit.signIn.reason.unknown_user",
  inactive: "audit.signIn.reason.inactive",
  two_factor_failed: "audit.signIn.reason.two_factor_failed",
  wrong_current_password: "audit.signIn.reason.wrong_current_password",
  password_changed: "audit.signIn.reason.password_changed",
  password_ok_must_change: "audit.signIn.reason.password_ok_must_change",
};

/** Why an attempt ended as it did, in words; never the stored code. Null for a plain successful sign-in. */
export function signInReason(reason: string | null): string | null {
  if (reason === null) return null;
  if (reason.startsWith("password_ok_two_factor")) return t("audit.signIn.reason.password_ok_two_factor");
  return t(SIGN_IN_REASON[reason] ?? "audit.signIn.reason.other");
}

const whenText = (onBs: string | null, time: string, at: string) => t("audit.when", { date: onBs ? formatBsDate(onBs) : at.slice(0, 10), time });

function Tabs({ current }: { current: "trail" | "signIns" }) {
  return (
    <nav aria-label={t("audit.tabs")}>
      <ul className={setupStyles.tabs}>
        <li>
          <Link className={setupStyles.tab} href="/portal/reports/activity" aria-current={current === "trail" ? "page" : undefined}>
            {t("audit.tab.trail")}
          </Link>
        </li>
        <li>
          <Link className={setupStyles.tab} href="/portal/reports/sign-ins" aria-current={current === "signIns" ? "page" : undefined}>
            {t("audit.tab.signIns")}
          </Link>
        </li>
      </ul>
    </nav>
  );
}

function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className={styles.pager} aria-label={t("audit.pages")}>
      <span className={styles.meta}>{t("audit.count", { from, to, total })}</span>
      <span className={styles.pagerButtons}>
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t("audit.previous")}
        </Button>
        <Button variant="secondary" disabled={to >= total} onClick={() => onPage(page + 1)}>
          {t("audit.next")}
        </Button>
      </span>
    </nav>
  );
}

/** The shape of the list while it loads: rows, not a lone spinner (D-030). */
function ListSkeleton() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{t("setup.loading")}</span>
      <ul className={styles.list} aria-hidden>
        {[0, 1, 2, 3].map((n) => (
          <li key={n} className={styles.row}>
            <Skeleton width="70%" height="1.1rem" />
            <Skeleton width="40%" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Failed({ status, onRetry }: { status: "failed" | "forbidden"; onRetry: () => void }) {
  if (status === "forbidden") return <Notice tone="bad">{t("audit.forbidden")}</Notice>;
  return (
    <Notice tone="bad">
      <span className={styles.line}>
        {t("audit.loadFailed")}
        <Button variant="secondary" onClick={onRetry}>
          {t("audit.retry")}
        </Button>
      </span>
    </Notice>
  );
}

/** One page of the audit trail. Pure, so tests draw it without a network. */
export function AuditTrailList({ data }: { data: AuditTrail }) {
  if (data.rows.length === 0) return <p className={setupStyles.empty}>{t("audit.empty")}</p>;
  return (
    <ul className={styles.list}>
      {data.rows.map((row) => (
        <li key={row.id} className={styles.row}>
          <p className={styles.summary}>{row.summary}</p>
          <p className={styles.meta}>
            {row.actor ?? t("audit.bySystem")} · {whenText(row.onBs, row.time, row.at)}
          </p>
          {row.reason ? <p className={styles.meta}>{t("audit.reason", { reason: row.reason })}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/** One page of sign-in attempts. Pure, so tests draw it without a network. Success or failure is said in words. */
export function SignInList({ data }: { data: SignInLog }) {
  if (data.rows.length === 0) return <p className={setupStyles.empty}>{t("audit.empty")}</p>;
  return (
    <ul className={styles.list}>
      {data.rows.map((row) => {
        const why = signInReason(row.reason);
        return (
          <li key={row.id} className={styles.row}>
            <span className={styles.line}>
              <Badge tone={row.success ? "ok" : "bad"}>{t(row.success ? "audit.signIn.ok" : "audit.signIn.failed")}</Badge>
              <span className={styles.summary}>{row.name ?? row.email}</span>
            </span>
            <p className={styles.meta}>
              {row.name && row.name !== row.email ? `${row.email} · ` : ""}
              {whenText(row.onBs, row.time, row.at)}
              {row.ip ? ` · ${t("audit.signIn.ip", { ip: row.ip })}` : ""}
            </p>
            {why ? <p className={styles.meta}>{why}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

function SearchForm({ initial, onSearch, children }: { initial: string; onSearch: (q: string) => void; children?: ReactNode }) {
  const [q, setQ] = useState(initial);
  return (
    <form
      className={styles.filters}
      role="search"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSearch(q.trim());
      }}
    >
      {children}
      <Field label={t("audit.search")} hint={t("audit.searchHint")} value={q} maxLength={100} onChange={(event) => setQ(event.target.value)} />
      <Button type="submit" variant="secondary">
        {t("audit.searchButton")}
      </Button>
    </form>
  );
}

export function AuditTrailScreen() {
  const { api } = useSession();
  const [query, setQuery] = useState<{ page: number; area?: Area; q?: string }>({ page: 1 });
  const load = useCallback(() => loadAuditTrail(api, query), [api, query]);
  const { view, reload } = useLoad(load);
  return (
    <div className={styles.page}>
      <h1 className={setupStyles.title}>{t("audit.title")}</h1>
      <Tabs current="trail" />
      <p className={setupStyles.muted}>{t("audit.intro")}</p>
      <SearchForm initial={query.q ?? ""} onSearch={(q) => setQuery((old) => ({ ...old, page: 1, q: q || undefined }))}>
        <Select
          label={t("audit.area")}
          value={query.area ?? ""}
          onChange={(event) => {
            const area = AREAS.find((a) => a === event.target.value);
            setQuery((old) => ({ ...old, page: 1, area }));
          }}
          options={[{ value: "", label: t("audit.area.all") }, ...AREAS.map((a) => ({ value: a, label: t(AREA_LABEL[a]) }))]}
        />
      </SearchForm>
      {view.status === "loading" ? <ListSkeleton /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <Failed status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? (
        <>
          <AuditTrailList data={view.data} />
          <Pager page={view.data.page} pageSize={view.data.pageSize} total={view.data.total} onPage={(page) => setQuery((old) => ({ ...old, page }))} />
        </>
      ) : null}
    </div>
  );
}

export function SignInsScreen() {
  const { api } = useSession();
  const [query, setQuery] = useState<{ page: number; failedOnly: boolean; q?: string }>({ page: 1, failedOnly: false });
  const load = useCallback(() => loadSignIns(api, query), [api, query]);
  const { view, reload } = useLoad(load);
  return (
    <div className={styles.page}>
      <h1 className={setupStyles.title}>{t("audit.signIns.title")}</h1>
      <Tabs current="signIns" />
      <p className={setupStyles.muted}>{t("audit.signIns.intro")}</p>
      <SearchForm initial={query.q ?? ""} onSearch={(q) => setQuery((old) => ({ ...old, page: 1, q: q || undefined }))}>
        <Select
          label={t("audit.show")}
          value={query.failedOnly ? "failed" : "all"}
          onChange={(event) => setQuery((old) => ({ ...old, page: 1, failedOnly: event.target.value === "failed" }))}
          options={[
            { value: "all", label: t("audit.show.all") },
            { value: "failed", label: t("audit.show.failed") },
          ]}
        />
      </SearchForm>
      {view.status === "loading" ? <ListSkeleton /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <Failed status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? (
        <>
          <SignInList data={view.data} />
          <Pager page={view.data.page} pageSize={view.data.pageSize} total={view.data.total} onPage={(page) => setQuery((old) => ({ ...old, page }))} />
        </>
      ) : null}
    </div>
  );
}
