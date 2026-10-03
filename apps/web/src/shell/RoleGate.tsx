"use client";

import type { ReactNode } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Notice } from "@/ui";

/**
 * A page that belongs to other roles, opened by its address, says so in one way everywhere (admin FUT F-14), instead
 * of an empty screen, a form that cannot be sent, or a "check your connection" error. Only tidiness: the server
 * refuses every action on such a page anyway (D-025). Until the session is known it draws the page as before.
 */
export function RoleGate({ roles, children }: { roles: readonly string[]; children: ReactNode }) {
  const { me } = useSession();
  if (me && !me.roles.some((r) => roles.includes(r.role))) return <Notice tone="bad">{t("setup.forbidden")}</Notice>;
  return <>{children}</>;
}
