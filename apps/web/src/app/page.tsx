"use client";

import Link from "next/link";

import { ConfigGate } from "@/config/ConfigGate";
import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { PublicShell } from "@/shell/PublicShell";
import { Badge, Card, buttonClass } from "@/ui";

import styles from "./home.module.css";

// A placeholder home page. The real public website is Phase 2; this proves the school's name,
// sections and theme reach the page from its configuration.
function Welcome() {
  const { config } = useConfig();
  if (!config) return null;

  return (
    <Card className={styles.hero}>
      <h1 className={styles.title}>{t("home.welcome", { school: config.school.name })}</h1>
      <p className={styles.intro}>{t("home.intro")}</p>
      <ul className={styles.sections}>
        {config.sections.map((section) => (
          <li key={section.key}>
            <Badge tone="primary">{section.name}</Badge>
          </li>
        ))}
      </ul>
      <div>
        <Link href="/sign-in" className={buttonClass()}>
          {t("shell.signIn")}
        </Link>
      </div>
    </Card>
  );
}

export default function Home() {
  return (
    <PublicShell>
      <ConfigGate>
        <Welcome />
      </ConfigGate>
    </PublicShell>
  );
}
