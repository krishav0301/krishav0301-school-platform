"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { ApplyScreen, VerifyScreen } from "@/admissions/ApplyScreen";
import { ConfigGate } from "@/config/ConfigGate";
import { PublicShell } from "@/shell/PublicShell";
import { tokenFromHash } from "@/reset/token";
import { applyRedirectFor } from "@/site/scroll/choose-home";
import { useSite } from "@/site/SiteFrame";
import { Skeleton } from "@/ui";

import styles from "./apply.module.css";

// The confirmation link is `/apply#token=...`, the fragment never reaching a server (same idea as
// password reset). The server-built page has none, so it starts on the form and switches once the
// browser reports the fragment.
const subscribeToHash = (listener: () => void) => {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
};
const readHash = () => window.location.hash;
const noHashOnServer = () => "";

/**
 * Apply for admission: open to everyone, no sign-in. A school with the one-page layout has its form on the front page and
 * no apply page of its own (D-167, PM 2026-10-13): a visitor is sent there, and sees none of this page meanwhile.
 */
export default function ApplyPage() {
  const hash = useSyncExternalStore(subscribeToHash, readHash, noHashOnServer);
  const token = tokenFromHash(hash);
  const { view } = useSite();
  const router = useRouter();
  const redirect = applyRedirectFor(view);

  useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);

  return (
    <PublicShell>
      <div className={styles.page}>
        {view.status === "loading" || redirect ? <Skeleton height="12rem" /> : <ConfigGate>{token ? <VerifyScreen token={token} /> : <ApplyScreen />}</ConfigGate>}
      </div>
    </PublicShell>
  );
}
