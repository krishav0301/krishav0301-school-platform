"use client";

import { Check, Info, Nfc, WifiOff, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { ConfigGate } from "@/config/ConfigGate";
import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { Button, Field, Notice, PasswordField } from "@/ui";

import { checkKey, sendScan, signInComputer } from "./client";
import { KEY_KEY, SAME_TAP_MS, look, newScanId, nepalClock, readQueue, savedLook, unreadableLook, writeQueue, type Look, type PendingScan } from "./model";
import styles from "./gate.module.css";

/** How long an answer stays on the screen before it goes back to waiting for the next card. */
const SHOW_MS = 4500;
const RETRY_MS = 15_000;

const readKey = (): string => {
  try {
    return localStorage.getItem(KEY_KEY) ?? "";
  } catch {
    return "";
  }
};

/**
 * The screen at the school gate (D-175). A card reader plugged into this computer types the card's number into a box
 * that is always focused and presses Enter; each tap is sent to the server with this computer's own key. The screen
 * answers at once with a name and a colour, makes a short sound, and goes back to waiting. If the connection is down,
 * the tap is kept on this computer and sent when it returns, so a tap is never lost and never counted twice.
 */
export function GateScreen() {
  return (
    <main id="main" className={styles.stage}>
      <ConfigGate>
        <Gate />
      </ConfigGate>
    </main>
  );
}

function Gate() {
  const [phase, setPhase] = useState<"checking" | "connect" | "ready">("checking");
  const [device, setDevice] = useState("");
  const keyRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const key = readKey();
      if (!key) return setPhase("connect");
      const result = await checkKey(key);
      if (cancelled) return;
      if (result.kind === "bad_key") {
        try {
          localStorage.removeItem(KEY_KEY);
        } catch {
          /* nothing to remove */
        }
        return setPhase("connect");
      }
      keyRef.current = key;
      // Unreachable at start-up still opens the gate: taps are kept and sent when the connection returns.
      setDevice(result.kind === "ok" ? result.account : "");
      setPhase("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (phase === "checking") return <p role="status" className={styles.checking}>{t("gate.checking")}</p>;
  if (phase === "connect") {
    return (
      <Connect
        onConnected={(key, name) => {
          keyRef.current = key;
          setDevice(name);
          setPhase("ready");
        }}
      />
    );
  }
  return <Reader keyRef={keyRef} device={device} onBadKey={() => setPhase("connect")} />;
}

function Connect({ onConnected }: { onConnected: (key: string, account: string) => void }) {
  const [gateId, setGateId] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [computer, setComputer] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = gateId.trim().length > 0 && password.length > 0 && code.replace(/s+/g, "").length === 6;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setProblem(null);
    const result = await signInComputer({ gateId: gateId.trim(), password: password.trim(), code: code.replace(/s+/g, ""), computer: computer.trim() });
    setBusy(false);
    if (result.kind === "ok") {
      try {
        localStorage.setItem(KEY_KEY, result.key);
      } catch {
        /* the gate still works until the page is closed */
      }
      return onConnected(result.key, result.account);
    }
    // The code is good once, so a wrong try needs a new one; clear it so the next is typed fresh.
    setCode("");
    setProblem(t(result.kind === "wrong" ? "gate.connect.bad" : result.kind === "throttled" ? "gate.connect.throttled" : "gate.connect.unreachable"));
  }
  return (
    <form onSubmit={submit} noValidate className={styles.connect}>
      <h1 className={styles.connectTitle}>{t("gate.connect.title")}</h1>
      <p className={styles.muted}>{t("gate.connect.body")}</p>
      {problem ? <Notice tone="bad">{problem}</Notice> : null}
      <Field label={t("gate.connect.id")} value={gateId} onChange={(event) => setGateId(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus />
      <PasswordField
        label={t("gate.connect.password")}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="current-password"
        showText={t("signIn.show")}
        hideText={t("signIn.hide")}
        showLabel={t("signIn.showPassword")}
        hideLabel={t("signIn.hidePassword")}
      />
      <Field label={t("gate.connect.code")} hint={t("gate.connect.codeHint")} value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} />
      <Field label={t("gate.connect.computer")} hint={t("gate.connect.computerHint")} value={computer} onChange={(event) => setComputer(event.target.value)} maxLength={60} autoComplete="off" />
      <Button type="submit" loading={busy} loadingLabel={t("gate.connect.connecting")} disabled={!ready}>
        {t("gate.connect.button")}
      </Button>
    </form>
  );
}

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

/** A short tone: one rising note for a welcome, two low ones for a card that does not count. Silent if the browser forbids it. */
function makeSound(context: { current: AudioContext | null }, sound: "ok" | "no" | null): void {
  if (!sound) return;
  try {
    const Context = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!Context) return;
    const audio = (context.current ??= new Context());
    void audio.resume();
    const notes = sound === "ok" ? [{ at: 0, hz: 880, length: 0.14 }] : [{ at: 0, hz: 220, length: 0.16 }, { at: 0.22, hz: 220, length: 0.16 }];
    for (const note of notes) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = note.hz;
      gain.gain.setValueAtTime(0.0001, audio.currentTime + note.at);
      gain.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + note.at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + note.at + note.length);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(audio.currentTime + note.at);
      oscillator.stop(audio.currentTime + note.at + note.length + 0.02);
    }
  } catch {
    /* no sound is not an error */
  }
}

function Reader({ keyRef, device, onBadKey }: { keyRef: { current: string }; device: string; onBadKey: () => void }) {
  const { term, config } = useConfig();
  const input = useRef<HTMLInputElement>(null);
  const audio = useRef<AudioContext | null>(null);
  const last = useRef<{ number: string; at: number }>({ number: "", at: 0 });
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushing = useRef(false);
  const [shown, setShown] = useState<Look | null>(null);
  const [waiting, setWaiting] = useState(() => readQueue(localStorage).length);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [clock, setClock] = useState(() => nepalClock(new Date()));

  const show = useCallback((next: Look) => {
    setShown(next);
    makeSound(audio, next.sound);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setShown(null), SHOW_MS);
  }, []);

  const keyFailed = useCallback(() => {
    try {
      localStorage.removeItem(KEY_KEY);
    } catch {
      /* nothing to remove */
    }
    onBadKey();
  }, [onBadKey]);

  const keep = useCallback((scan: PendingScan) => {
    const queue = [...readQueue(localStorage), scan];
    writeQueue(localStorage, queue);
    setWaiting(queue.length);
  }, []);

  /** Sends what was kept while offline, oldest first, stopping at the first one that cannot be sent. */
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      let queue = readQueue(localStorage);
      while (queue.length > 0) {
        const outcome = await sendScan(keyRef.current, queue[0]!);
        if (outcome.kind === "offline") break;
        if (outcome.kind === "bad_key") return keyFailed();
        queue = queue.slice(1);
        writeQueue(localStorage, queue);
        setWaiting(queue.length);
      }
    } finally {
      flushing.current = false;
    }
  }, [keyRef, keyFailed]);

  const tap = useCallback(
    async (raw: string) => {
      const number = raw.trim();
      if (!number) return;
      const nowMs = Date.now();
      if (last.current.number === number && nowMs - last.current.at < SAME_TAP_MS) return;
      last.current = { number, at: nowMs };
      const scan: PendingScan = { scanId: newScanId(), cardNumber: number, at: new Date(nowMs).toISOString() };
      const outcome = await sendScan(keyRef.current, scan);
      if (outcome.kind === "answer") {
        show(look(outcome.answer, term));
        void flush();
      } else if (outcome.kind === "bad_key") keyFailed();
      else if (outcome.kind === "refused") show(unreadableLook());
      else {
        keep(scan);
        show(savedLook());
      }
    },
    [flush, keep, keyFailed, keyRef, show, term],
  );

  useEffect(() => {
    input.current?.focus();
    void flush();
    const retry = setInterval(() => void flush(), RETRY_MS);
    const tick = setInterval(() => setClock(nepalClock(new Date())), 20_000);
    const up = () => {
      setOnline(true);
      void flush();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      clearInterval(retry);
      clearInterval(tick);
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, [flush]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const value = event.currentTarget.value;
    event.currentTarget.value = "";
    void tap(value);
  }

  const offline = !online || waiting > 0;
  return (
    // Any press on the screen puts the cursor back in the reader's box, so a stray click cannot leave it deaf.
    <div className={styles.screen} onClick={() => input.current?.focus()}>
      <div className={styles.center} aria-live="polite" aria-atomic="true">
        {shown ? (
          <div className={styles.answer} data-tone={shown.tone}>
            <span className={styles.mark} aria-hidden>
              {shown.tone === "bad" ? <X /> : shown.tone === "warn" ? <Info /> : <Check />}
            </span>
            <p className={styles.name}>{shown.title}</p>
            {shown.detail ? <p className={styles.detail}>{shown.detail}</p> : null}
          </div>
        ) : (
          <div className={styles.idle}>
            <span className={styles.mark} data-tone="idle" aria-hidden>
              <Nfc />
            </span>
            <p className={styles.school}>{config?.school.name}</p>
            <p className={styles.name}>{t("gate.idle.title")}</p>
            <p className={styles.detail}>{t("gate.idle.hint")}</p>
          </div>
        )}
      </div>
      <footer className={styles.foot}>
        <span>{device}</span>
        <span className={styles.clock}>{clock}</span>
        <span className={styles.status} data-offline={offline ? "" : undefined}>
          {!online ? <WifiOff aria-hidden /> : null}
          {t(online ? "gate.status.online" : "gate.status.offline")}
          {waiting > 0 ? ` · ${t("gate.status.waiting", { count: String(waiting) })}` : ""}
        </span>
      </footer>
      <input
        ref={input}
        className="sr-only"
        aria-label={t("gate.input.label")}
        inputMode="none"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => input.current?.focus(), 0)}
      />
    </div>
  );
}
