import Link from "next/link";

import { t } from "@/i18n/messages";
import { buttonClass } from "@/ui";

import styles from "./sign-in-home.module.css";

/**
 * The front page of a school without the one-page layout (PM, 2026-10-18, D-177): one Sign in button in the middle of an
 * empty page. The old public pages are gone; a school gets a public site by choosing a layout in its pack. The school's
 * name is the page's heading for a screen reader only, and the tab title says it for everyone else. A person who is
 * already signed in is sent to the portal instead.
 */
export function SignInHome({ schoolName, signedIn }: { schoolName?: string; signedIn: boolean }) {
  return (
    <main id="main" className={styles.stage}>
      {schoolName ? <h1 className="sr-only">{schoolName}</h1> : null}
      <Link href={signedIn ? "/portal" : "/sign-in"} className={`${buttonClass()} ${styles.wrapLabel}`}>
        {t(signedIn ? "scroll.portal" : "scroll.signIn")}
      </Link>
    </main>
  );
}
