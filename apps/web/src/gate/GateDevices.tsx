"use client";

import { useCallback, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { formatBsDate } from "@/content/model";
import { t } from "@/i18n/messages";
import { EmptyLine, Panel, StatusWord, TableSkeleton, readStyles } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { Button, CopyButton, Field, Notice } from "@/ui";

import type { DeviceList } from "./client";
import { loadDevices, registerDevice, revokeDevice } from "./devices-client";
import styles from "./gate.module.css";

type Device = DeviceList["devices"][number];

/** Where the gate screen lives: the same address on every computer. */
const gateAddress = () => (typeof window === "undefined" ? "/gate" : `${window.location.origin}/gate`);

/**
 * The gate computers (D-175), on the Admin's Settings page: register one to get its key, and revoke one that is lost or
 * retired. Shown only to an Admin or Support, and only where the school uses cards; the server decides again.
 */
export function GateDevicesCard() {
  const { moduleEnabled } = useConfig();
  const { me } = useSession();
  const allowed = me?.roles.some((r) => r.role === "admin" || r.role === "super_admin") ?? false;
  if (!allowed || !moduleEnabled("card_attendance")) return null;
  return <Devices />;
}

function Devices() {
  const { api } = useSession();
  const load = useCallback(() => loadDevices(api), [api]);
  const { view, reload } = useLoad<DeviceList>(load);
  const [key, setKey] = useState<{ name: string; key: string } | null>(null);

  return (
    <Panel title={t("gate.devices.title")} labelledBy="gate-devices-title">
      <p className={readStyles.rowMeta}>{t("gate.devices.intro")}</p>
      {key ? <KeyNotice name={key.name} secret={key.key} onDone={() => setKey(null)} /> : <AddForm onMade={(name, secret) => { setKey({ name, key: secret }); void reload(); }} />}
      {view.status === "loading" ? <TableSkeleton rows={2} /> : null}
      {view.status === "failed" ? <Notice tone="bad">{t("gate.devices.loadFailed")}</Notice> : null}
      {view.status === "ready" && view.data.devices.length === 0 ? <EmptyLine>{t("gate.devices.empty")}</EmptyLine> : null}
      {view.status === "ready" && view.data.devices.length > 0 ? (
        <ul className={styles.deviceList}>
          {view.data.devices.map((device) => (
            <DeviceRow key={device.id} device={device} onRevoked={() => void reload()} />
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

/** The key, once. It is held only in this screen's state: never in the address, storage or a log. */
function KeyNotice({ name, secret, onDone }: { name: string; secret: string; onDone: () => void }) {
  return (
    <section role="status" className={styles.keyNotice}>
      <h3 className={styles.keyTitle}>{t("gate.devices.keyTitle", { name })}</h3>
      <p className={styles.key}>{secret}</p>
      <p className={readStyles.rowMeta}>{t("gate.devices.keyBody", { address: gateAddress() })}</p>
      <div className={styles.row}>
        <CopyButton text={secret} label={t("gate.devices.keyCopy")} copiedLabel={t("gate.devices.keyCopied")} />
        <Button onClick={onDone}>{t("gate.devices.keyDone")}</Button>
      </div>
    </section>
  );
}

function AddForm({ onMade }: { onMade: (name: string, key: string) => void }) {
  const { api } = useSession();
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || name.trim().length < 2) return;
    setProblem(null);
    setSaving(true);
    const result = await registerDevice(api, name.trim());
    setSaving(false);
    if (result.ok) {
      setName("");
      return onMade(result.name, result.key);
    }
    setProblem(result.reason === "invalid" ? result.message : t("gate.devices.failed"));
  }
  return (
    <form onSubmit={submit} noValidate className={styles.addForm}>
      {problem ? <Notice tone="bad">{problem}</Notice> : null}
      <Field label={t("gate.devices.name")} hint={t("gate.devices.nameHint")} value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoComplete="off" />
      <div>
        <Button type="submit" variant="secondary" loading={saving} loadingLabel={t("gate.devices.adding")} disabled={name.trim().length < 2}>
          {t("gate.devices.add")}
        </Button>
      </div>
    </form>
  );
}

function DeviceRow({ device, onRevoked }: { device: Device; onRevoked: () => void }) {
  const { api } = useSession();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function revoke() {
    setBusy(true);
    setFailed(false);
    const ok = await revokeDevice(api, device.id);
    setBusy(false);
    if (ok) return onRevoked();
    setFailed(true);
  }
  const used = device.lastSeenOnBs && device.lastSeenTime ? t("gate.devices.lastUsed", { date: formatBsDate(device.lastSeenOnBs), time: device.lastSeenTime }) : t("gate.devices.neverUsed");
  return (
    <li className={styles.device}>
      <div className={styles.deviceHead}>
        <span className={styles.deviceName}>{device.name}</span>
        <StatusWord tone={device.status === "active" ? "ok" : "neutral"}>{t(device.status === "active" ? "gate.devices.active" : "gate.devices.revoked")}</StatusWord>
      </div>
      <p className={readStyles.rowMeta}>{used}</p>
      {failed ? <Notice tone="bad">{t("gate.devices.failed")}</Notice> : null}
      {device.status === "active" ? (
        asking ? (
          <div className={styles.confirm}>
            <p className={readStyles.rowMeta}>{t("gate.devices.revokeSure", { name: device.name })}</p>
            <div className={styles.row}>
              <Button variant="secondary" loading={busy} loadingLabel={t("cards.saving")} onClick={() => void revoke()}>
                {t("gate.devices.revokeYes")}
              </Button>
              <Button variant="quiet" disabled={busy} onClick={() => setAsking(false)}>
                {t("gate.devices.revokeNo")}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button variant="quiet" onClick={() => setAsking(true)}>
              {t("gate.devices.revoke")}
            </Button>
          </div>
        )
      ) : null}
    </li>
  );
}
