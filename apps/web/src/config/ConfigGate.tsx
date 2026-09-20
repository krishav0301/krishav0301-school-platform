"use client";

import type { ReactNode } from "react";

import { t } from "@/i18n/messages";
import { Button, Notice, Spinner } from "@/ui";

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
  return <Spinner label={t("config.loading")} />;
}
