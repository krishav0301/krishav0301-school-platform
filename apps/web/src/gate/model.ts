import type { components } from "@/api/schema";
import { t } from "@/i18n/messages";

export type GateScanResult = components["schemas"]["GateScanResult"];

/** One tap, as the gate page makes it. `scanId` is made once per tap, so a tap sent twice is one tap on the server. */
export interface PendingScan {
  scanId: string;
  cardNumber: string;
  at: string;
}

export type Tone = "ok" | "neutral" | "warn" | "bad";

/** What the big screen says for an answer: its colour, the words, and which sound to make. Pure. */
export interface Look {
  tone: Tone;
  title: string;
  detail: string | null;
  sound: "ok" | "no" | null;
}

const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kathmandu", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** The time of day in Nepal, "08:12". */
export const nepalClock = (iso: string | Date): string => clock.format(typeof iso === "string" ? new Date(iso) : iso);

/** Who a person is, for the line under the greeting: a student's course and level, a staff member's role in the school's own words. */
function detailOf(answer: GateScanResult, term: (key: string) => string): string | null {
  const person = answer.person;
  if (!person) return null;
  if (person.kind === "student") return person.place;
  return person.role ? term(`role.${person.role}`) : null;
}

export function look(answer: GateScanResult, term: (key: string) => string): Look {
  const name = answer.person?.name ?? "";
  switch (answer.result) {
    case "marked":
      return { tone: "ok", title: t("gate.welcome", { name }), detail: detailOf(answer, term), sound: "ok" };
    case "again":
      return { tone: "neutral", title: t("gate.welcome", { name }), detail: t("gate.again", { time: nepalClock(answer.firstAt ?? answer.at) }), sound: "ok" };
    case "recorded":
      return { tone: "ok", title: t("gate.welcome", { name }), detail: t("gate.noted"), sound: "ok" };
    case "no_school":
      return { tone: "warn", title: t("gate.noSchool"), detail: name || null, sound: null };
    case "retired":
      return { tone: "bad", title: t("gate.retired"), detail: name || null, sound: "no" };
    case "inactive":
      return { tone: "bad", title: t("gate.inactive"), detail: name || null, sound: "no" };
    default:
      return { tone: "bad", title: t("gate.unknown"), detail: null, sound: "no" };
  }
}

export const unreadableLook = (): Look => ({ tone: "bad", title: t("gate.unreadable"), detail: null, sound: "no" });
export const savedLook = (): Look => ({ tone: "warn", title: t("gate.saved"), detail: null, sound: "ok" });

// --- The taps kept while the connection is down ---------------------------------------------------------------------

export const QUEUE_KEY = "gate.queue";
export const KEY_KEY = "gate.key";
/** The server takes a tap up to a week old; older ones are dropped here instead of retried for ever. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** The most taps kept, so a long outage cannot fill the computer's storage. */
export const QUEUE_LIMIT = 2000;

type Store = Pick<Storage, "getItem" | "setItem">;

export function readQueue(store: Store, now = Date.now()): PendingScan[] {
  try {
    const parsed: unknown = JSON.parse(store.getItem(QUEUE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is PendingScan => typeof e?.scanId === "string" && typeof e?.cardNumber === "string" && typeof e?.at === "string" && now - Date.parse(e.at) <= WEEK_MS);
  } catch {
    return [];
  }
}

export function writeQueue(store: Store, queue: readonly PendingScan[]): void {
  try {
    store.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-QUEUE_LIMIT)));
  } catch {
    // Storage full or blocked: the tap is lost only if the page is also closed before the connection returns.
  }
}

export function newScanId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Some readers send the same card twice in a flash. The same number within this many milliseconds is one tap. */
export const SAME_TAP_MS = 1500;
