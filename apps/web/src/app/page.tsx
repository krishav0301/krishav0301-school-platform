"use client";

import { useEffect, useState } from "react";

import { createApiClient } from "@/api/client";

import styles from "./page.module.css";

type Status = "ok" | "down" | "unreachable" | "checking";

async function checkApi(): Promise<{ api: Status; database: Status }> {
  try {
    const { data, error } = await createApiClient().GET("/api/health");
    const body = data ?? error;
    if (!body) return { api: "unreachable", database: "unreachable" };
    return { api: "ok", database: body.database };
  } catch {
    return { api: "unreachable", database: "unreachable" };
  }
}

function Pill({ value }: { value: Status }) {
  const tone = value === "ok" ? styles.ok : value === "checking" ? styles.pending : styles.bad;
  return <span className={`${styles.pill} ${tone}`}>{value}</span>;
}

export default function Home() {
  const [state, setState] = useState<{ api: Status; database: Status }>({
    api: "checking",
    database: "checking",
  });

  useEffect(() => {
    let active = true;
    checkApi().then((result) => {
      if (active) setState(result);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1 className={styles.title}>School Platform</h1>
        <p className={styles.subtitle}>Foundation check</p>
        <div className={styles.row}>
          <span>API</span>
          <Pill value={state.api} />
        </div>
        <div className={styles.row}>
          <span>Database</span>
          <Pill value={state.database} />
        </div>
      </section>
    </main>
  );
}
