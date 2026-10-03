"use client";

import Link from "next/link";
import { useCallback, useState, type FormEvent, type ReactNode } from "react";

import { formatBsDate } from "@/content/model";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { useLoad } from "@/setup/useLoad";
import { EmptyLine, Panel, ReadFailure, ReadHeader, StatusWord, TableSkeleton, readStyles } from "@/read/ReadView";
import { Button, Field, Select } from "@/ui";

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

/** One page of the audit trail. Pure, so tests draw it without a network. */
export function AuditTrailList({ data }: { data: AuditTrail }) {
  if (data.rows.length === 0) return <EmptyLine>{t("audit.empty")}</EmptyLine>;
  return (
    <ul className={readStyles.rows}>
      {data.rows.map((row) => (
        <li key={row.id} className={readStyles.rowItem}>
          <p className={readStyles.rowTitle}>{row.summary}</p>
          <p className={readStyles.rowMeta}>
            {row.actor ?? t("audit.bySystem")} · {whenText(row.onBs, row.time, row.at)}
          </p>
          {row.reason ? <p className={readStyles.rowMeta}>{t("audit.reason", { reason: row.reason })}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/** One page of sign-in attempts. Pure, so tests draw it without a network. Success or failure is said in words. */
export function SignInList({ data }: { data: SignInLog }) {
  if (data.rows.length === 0) return <EmptyLine>{t("audit.empty")}</EmptyLine>;
  return (
    <ul className={readStyles.rows}>
      {data.rows.map((row) => {
        const why = signInReason(row.reason);
        return (
          <li key={row.id} className={readStyles.rowItem}>
            <div className={readStyles.rowHead}>
              <p className={readStyles.rowTitle}>{row.name ?? row.email}</p>
              <StatusWord tone={row.success ? "ok" : "bad"}>{t(row.success ? "audit.signIn.ok" : "audit.signIn.failed")}</StatusWord>
            </div>
            <p className={readStyles.rowMeta}>
              {row.name && row.name !== row.email ? `${row.email} · ` : ""}
              {whenText(row.onBs, row.time, row.at)}
              {row.ip ? ` · ${t("audit.signIn.ip", { ip: row.ip })}` : ""}
            </p>
            {why ? <p className={readStyles.rowMeta}>{why}</p> : null}
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
    <div className={readStyles.page}>
      <Tabs current="trail" />
      <ReadHeader title={t("audit.title")} subtitle={t("audit.intro")} crumbs={[{ label: t("reports.title"), href: "/portal/reports" }, { label: t("audit.title") }]} />
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
      {view.status === "loading" ? <TableSkeleton rows={6} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? (
        <>
          <Panel>
            <AuditTrailList data={view.data} />
          </Panel>
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
    <div className={readStyles.page}>
      <Tabs current="signIns" />
      <ReadHeader title={t("audit.signIns.title")} subtitle={t("audit.signIns.intro")} crumbs={[{ label: t("reports.title"), href: "/portal/reports" }, { label: t("audit.signIns.title") }]} />
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
      {view.status === "loading" ? <TableSkeleton rows={6} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? (
        <>
          <Panel>
            <SignInList data={view.data} />
          </Panel>
          <Pager page={view.data.page} pageSize={view.data.pageSize} total={view.data.total} onPage={(page) => setQuery((old) => ({ ...old, page }))} />
        </>
      ) : null}
    </div>
  );
}
