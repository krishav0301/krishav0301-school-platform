"use client";

import { useSyncExternalStore } from "react";

import { ApplyScreen, VerifyScreen } from "@/admissions/ApplyScreen";
import { ConfigGate } from "@/config/ConfigGate";
import { PublicShell } from "@/shell/PublicShell";
import { tokenFromHash } from "@/reset/token";

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

/** Apply for admission: open to everyone, no sign-in. */
export default function ApplyPage() {
  const hash = useSyncExternalStore(subscribeToHash, readHash, noHashOnServer);
  const token = tokenFromHash(hash);

  return (
    <PublicShell>
      <div className={styles.page}>
        <ConfigGate>{token ? <VerifyScreen token={token} /> : <ApplyScreen />}</ConfigGate>
      </div>
    </PublicShell>
  );
}
