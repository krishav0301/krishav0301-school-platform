"use client";

import Link from "next/link";
import { useCallback } from "react";

import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Badge, Card } from "@/ui";

import { loadChecklist, type Checklist } from "./checklist-client";
import styles from "./setup.module.css";
import { Gate, useLoad } from "./useLoad";

const ITEMS: { key: keyof Checklist; label: MessageKey; href: string }[] = [
  { key: "year", label: "portal.checklist.year", href: "/portal/setup" },
  { key: "structure", label: "portal.checklist.structure", href: "/portal/setup/programmes" },
  { key: "classes", label: "portal.checklist.classes", href: "/portal/setup/classes" },
  { key: "terminals", label: "portal.checklist.terminals", href: "/portal/setup/terminals" },
  { key: "subjects", label: "portal.checklist.subjects", href: "/portal/setup/curriculum" },
  { key: "teachers", label: "portal.checklist.teachers", href: "/portal/people" },
  { key: "classTeachers", label: "portal.checklist.classTeachers", href: "/portal/people/teaching" },
];

/** The seven facts, in their fixed order, each a link to where it is fixed and a done/not-done badge. */
export function ChecklistView({ checklist }: { checklist: Checklist }) {
  return (
    <ul className={styles.checklistList}>
      {ITEMS.map((item) => (
        <li key={item.key} className={styles.checklistItem}>
          <Link href={item.href} className={styles.checklistLink}>
            {t(item.label)}
          </Link>
          <Badge tone={checklist[item.key] ? "ok" : "neutral"}>{t(checklist[item.key] ? "portal.checklist.done" : "portal.checklist.notDone")}</Badge>
        </li>
      ))}
    </ul>
  );
}

/**
 * What is left to set up, computed fresh on every load. Co-ordinator only (D-062, an open choice,
 * not specified by the design): the Admin's and Super Admin's dashboards are unchanged.
 */
export function ChecklistCard() {
  const { api, me } = useSession();
  const loadNow = useCallback(() => loadChecklist(api), [api]);
  const { view, reload } = useLoad(loadNow);

  if (!me?.roles.some((r) => r.role === "coordinator")) return null;

  return (
    <Card aria-labelledby="checklist-heading">
      <h2 id="checklist-heading" className={styles.subhead}>
        {t("portal.checklist.title")}
      </h2>
      <Gate view={view} onRetry={() => void reload()}>{(checklist) => <ChecklistView checklist={checklist} />}</Gate>
    </Card>
  );
}
