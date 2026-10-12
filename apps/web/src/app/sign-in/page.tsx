"use client";

import { ConfigGate } from "@/config/ConfigGate";

import { SignInFlow } from "./SignInFlow";
import styles from "./sign-in.module.css";

/** Sign-in only: the school gives each person their login, so there is no way to create an account here. */
export default function SignInPage() {
  return (
    <main id="main" className={styles.stage}>
      <ConfigGate>
        <SignInFlow />
      </ConfigGate>
    </main>
  );
}
