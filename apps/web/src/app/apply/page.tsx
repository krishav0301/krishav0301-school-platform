"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { VerifyScreen } from "@/admissions/ApplyScreen";
import { ConfigGate } from "@/config/ConfigGate";
import { PublicShell } from "@/shell/PublicShell";
import { tokenFromHash } from "@/reset/token";
import { applyRedirect } from "@/site/front-stage";
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
 * Confirms an applicant's email from the link in the message, open to everyone, no sign-in. The form itself is on the front
 * page of a school with the one-page layout (D-167); a school without one has no form (D-177). Whoever opens this page without
 * a link is sent to the front page, and sees none of this page meanwhile.
 */
export default function ApplyPage() {
  const hash = useSyncExternalStore(subscribeToHash, readHash, noHashOnServer);
  const token = tokenFromHash(hash);
  const { view } = useSite();
  const router = useRouter();
  // Only the confirmation link (`#token=`) is left of this page for a school without a form of its own; anyone else goes to the front page (D-177).
  const redirect = applyRedirect(view) ?? (view.status !== "loading" && !token ? "/" : null);

  useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);

  return (
    <PublicShell>
      <div className={styles.page}>
        {view.status === "loading" || redirect ? <Skeleton height="12rem" /> : <ConfigGate>{token ? <VerifyScreen token={token} /> : null}</ConfigGate>}
      </div>
    </PublicShell>
  );
}
