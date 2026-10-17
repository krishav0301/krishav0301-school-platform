import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { GateDevicesCard } from "@/gate/GateDevices";
import { GateScreen } from "@/gate/GateScreen";
import { QUEUE_KEY, QUEUE_LIMIT, look, nepalClock, readQueue, writeQueue, type GateScanResult, type PendingScan } from "@/gate/model";
import { SessionContext } from "@/session/SessionProvider";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";
import { fakeSession } from "./session";

vi.mock("next/navigation", () => ({ usePathname: () => "/gate", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const term = (key: string) => (key === "role.teacher" ? "Teacher" : key);
const answer = (over: Partial<GateScanResult>): GateScanResult => ({ result: "marked", person: { name: "Sita Sharma", kind: "student", role: null, place: "BBS · Year 1" }, at: "2026-10-18T02:27:00.000Z", firstAt: null, ...over });

describe("what the gate says", () => {
  it("welcomes a student by name and course, green, with a rising sound", () => {
    expect(look(answer({}), term)).toEqual({ tone: "ok", title: "Welcome, Sita Sharma", detail: "BBS · Year 1", sound: "ok" });
  });

  it("welcomes a teacher with their role in the school's words", () => {
    const l = look(answer({ person: { name: "Hari Rai", kind: "staff", role: "teacher", place: null } }), term);
    expect(l.detail).toBe("Teacher");
    expect(l.tone).toBe("ok");
  });

  it("says when the first tap of the day was, for a repeat, in Nepal time", () => {
    const l = look(answer({ result: "again", firstAt: "2026-10-18T02:27:00.000Z" }), term);
    expect(l.tone).toBe("neutral");
    expect(l.detail).toBe("Already counted at 08:12");
  });

  it("says no school today on the weekly holiday, in a warning colour and silently", () => {
    const l = look(answer({ result: "no_school" }), term);
    expect(l).toMatchObject({ tone: "warn", title: "No school today", sound: null });
  });

  it.each([
    ["unknown", "Card not recognised. Please see the office."],
    ["retired", "This card is no longer valid. Please see the office."],
    ["inactive", "This card is not in use. Please see the office."],
  ] as const)("refuses a %s card in red, with the low sound and the way forward", (result, words) => {
    const l = look(answer({ result, person: null }), term);
    expect(l).toMatchObject({ tone: "bad", title: words, sound: "no" });
  });

  it("shows Nepal time, not the computer's", () => {
    expect(nepalClock("2026-10-18T02:27:00.000Z")).toBe("08:12");
  });
});

describe("the taps kept while offline", () => {
  const store = () => {
    const data: Record<string, string> = {};
    return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v), data };
  };
  const scan = (n: number, at = new Date()): PendingScan => ({ scanId: `scan-${n}-aaaaaaaa`, cardNumber: `CARD${n}`, at: at.toISOString() });

  it("keeps them in order and reads them back", () => {
    const s = store();
    writeQueue(s, [scan(1), scan(2)]);
    expect(readQueue(s).map((e) => e.cardNumber)).toEqual(["CARD1", "CARD2"]);
  });

  it("drops a tap older than the week the server accepts, and anything that is not a tap", () => {
    const s = store();
    writeQueue(s, [scan(1, new Date(Date.now() - 8 * 24 * 3600 * 1000)), scan(2)]);
    s.setItem(QUEUE_KEY, JSON.stringify([...JSON.parse(s.data[QUEUE_KEY]!), { junk: true }]));
    expect(readQueue(s).map((e) => e.cardNumber)).toEqual(["CARD2"]);
  });

  it("survives broken storage", () => {
    expect(readQueue({ getItem: () => "{not json", setItem: () => {} })).toEqual([]);
    expect(() => writeQueue({ getItem: () => null, setItem: () => { throw new Error("full"); } }, [scan(1)])).not.toThrow();
  });

  it("keeps only the newest taps if an outage is very long", () => {
    const s = store();
    writeQueue(s, Array.from({ length: QUEUE_LIMIT + 5 }, (_, n) => scan(n)));
    expect(readQueue(s)).toHaveLength(QUEUE_LIMIT);
    expect(readQueue(s)[0]!.cardNumber).toBe("CARD5");
  });
});

const config = (cards: boolean): PublicConfig => ({
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: { card_attendance: cards, fees: true, results: true, attendance: true },
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
});
const asRole = (role: string) => fakeSession({ status: "signedIn", me: { id: "user-1", name: "Someone", roles: [{ role, scope: "institution" }] as never } });
const settingsCard = (cards: boolean, role: string) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config(cards))}>
      <SessionContext.Provider value={asRole(role)}>
        <GateDevicesCard />
      </SessionContext.Provider>
    </ConfigContext.Provider>,
  );

describe("the gate screen", () => {
  it("opens by checking the computer's key, not by showing the reader or a form", () => {
    const html = renderToStaticMarkup(
      <ConfigContext.Provider value={makeConfigValue("ready", config(true))}>
        <GateScreen />
      </ConfigContext.Provider>,
    );
    expect(html).toContain("Opening the gate");
    expect(html).not.toContain("Tap your card");
  });
});

describe("the gate computers card on Settings", () => {
  it("is left out where the school does not use cards, and for anyone but the Admin and Support", () => {
    expect(settingsCard(false, "admin")).toBe("");
    for (const role of ["coordinator", "accountant", "teacher", "student"]) expect(settingsCard(true, role)).toBe("");
  });

  it("is shown to the Admin and to Support where cards are used", () => {
    for (const role of ["admin", "super_admin"]) {
      const html = settingsCard(true, role);
      expect(html).toContain("Gate computers");
      expect(html).toContain("Register");
    }
  });
});
