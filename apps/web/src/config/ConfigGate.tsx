"use client";

import type { ReactNode } from "react";

import { t } from "@/i18n/messages";
import { Button, Card, Notice, Skeleton } from "@/ui";

import { useConfig } from "./ConfigProvider";

/** Shows its children once the school's configuration is available, and a clear message otherwise. */
export function ConfigGate({ children }: { children: ReactNode }) {
  const { status, retry } = useConfig();

  if (status === "ready") return <>{children}</>;
  if (status === "unprovisioned") return <Notice title={t("config.unprovisionedTitle")}>{t("config.unprovisionedBody")}</Notice>;
  if (status === "unreachable") {
    return (
      <Notice tone="bad" title={t("config.unreachableTitle")}>
        <p>{t("config.unreachableBody")}</p>
        <Button variant="secondary" onClick={retry}>
          {t("config.retry")}
        </Button>
      </Notice>
    );
  }
  // Show the shape of the page straight away, so nothing jumps when the content arrives.
  return (
    <Card aria-busy="true">
      <span role="status" className="sr-only">
        {t("config.loading")}
      </span>
      <Skeleton width="60%" height="1.75rem" />
      <Skeleton width="90%" />
      <Skeleton width="75%" />
      <Skeleton height="2.75rem" />
    </Card>
  );
}
