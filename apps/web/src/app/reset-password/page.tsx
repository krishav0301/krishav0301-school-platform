"use client";

import { useState, useSyncExternalStore } from "react";

import { ConfigGate } from "@/config/ConfigGate";
import { NewPasswordForm, RequestForm } from "@/reset/ResetForms";
import { tokenFromHash } from "@/reset/token";
import { PublicShell } from "@/shell/PublicShell";

import styles from "./reset-password.module.css";

// The link's token is in the URL fragment. The server-built page has none, so it starts on the
// "ask for a link" form and switches once the browser reports the fragment.
const subscribeToHash = (listener: () => void) => {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
};
const readHash = () => window.location.hash;
const noHashOnServer = () => "";

export default function ResetPasswordPage() {
  const hash = useSyncExternalStore(subscribeToHash, readHash, noHashOnServer);
  const [abandoned, setAbandoned] = useState(false);
  const token = abandoned ? null : tokenFromHash(hash);

  function getNewLink() {
    // Drop the used-up token from the address bar, then show the request form.
    window.history.replaceState(null, "", window.location.pathname);
    setAbandoned(true);
  }

  return (
    <PublicShell showSignIn={false}>
      <div className={styles.center}>
        <ConfigGate>{token ? <NewPasswordForm token={token} onLinkInvalid={getNewLink} /> : <RequestForm />}</ConfigGate>
      </div>
    </PublicShell>
  );
}
