"use client";

import { ListSkeleton, Pager, SearchBox } from "@/people/ListParts";
import styles from "@/people/people-access.module.css";
import { t } from "@/i18n/messages";
import { Button, HeroBand, Notice } from "@/ui";
import { StudentsTable, useStudents } from "@/admissions/StudentsScreen";

/**
 * The Accountant's Students tab (the PM, 2026-10-17): the list of students with a search bar, and for each one Record a
 * payment, which opens their fee account where the payment is taken.
 */
export function PaymentsScreen() {
  const list = useStudents();
  const data = list.view.status === "ready" ? list.view : null;
  return (
    <div className={styles.page}>
      <div className={styles.topMain}>
        <HeroBand>
          <h1 className={styles.title}>{t("payments.title")}</h1>
          <p className={styles.intro}>{t("payments.intro")}</p>
        </HeroBand>
      </div>
      <section className={styles.panel} aria-label={t("students.list")}>
        <div className={styles.panelHead}>
          <div className={styles.panelTools}>
            <SearchBox label="students.search" value={list.typed} onChange={list.setTyped} />
          </div>
        </div>
        {list.view.status === "loading" ? <ListSkeleton label="students.loading" /> : null}
        {list.view.status === "forbidden" ? <Notice tone="bad">{t("people.error.forbidden")}</Notice> : null}
        {list.view.status === "failed" ? (
          <div className={styles.state}>
            <p className={styles.stateTitle}>{t("students.loadFailed")}</p>
            <Button variant="secondary" onClick={list.reload}>
              {t("content.retry")}
            </Button>
          </div>
        ) : null}
        {data && data.students.length === 0 ? (
          <div className={styles.state}>
            <p className={styles.stateTitle}>{t(list.filtered ? "students.noneFound" : "students.empty")}</p>
            {list.filtered ? (
              <Button variant="secondary" onClick={list.clear}>
                {t("content.clearFilters")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {data && data.students.length > 0 ? (
          <>
            <StudentsTable students={data.students} payment />
            <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={list.setPage} noun="students.showing" />
          </>
        ) : null}
      </section>
    </div>
  );
}
