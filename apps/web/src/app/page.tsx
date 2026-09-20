import { createApiClient } from "@/api/client";

import styles from "./page.module.css";

// Always fetch fresh: this page reports live status.
export const dynamic = "force-dynamic";

type Status = "ok" | "down" | "unreachable";

async function checkApi(): Promise<{ api: Status; database: Status }> {
  try {
    const { data, error } = await createApiClient().GET("/api/health/");
    const body = data ?? error;
    if (!body) return { api: "unreachable", database: "unreachable" };
    return { api: "ok", database: body.database };
  } catch {
    return { api: "unreachable", database: "unreachable" };
  }
}

function Pill({ value }: { value: Status }) {
  const good = value === "ok";
  return <span className={`${styles.pill} ${good ? styles.ok : styles.bad}`}>{value}</span>;
}

export default async function Home() {
  const { api, database } = await checkApi();

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1 className={styles.title}>School Platform</h1>
        <p className={styles.subtitle}>Foundation check</p>
        <div className={styles.row}>
          <span>API</span>
          <Pill value={api} />
        </div>
        <div className={styles.row}>
          <span>Database</span>
          <Pill value={database} />
        </div>
      </section>
    </main>
  );
}
