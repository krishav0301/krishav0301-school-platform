import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CardFacts, CardPanel } from "@/cards/CardPanel";
import type { CardView } from "@/cards/client";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SessionContext } from "@/session/SessionProvider";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";
import { fakeSession } from "./session";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/admissions/student", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

// RFID cards (D-174) are a module that is off until a school's pack switches it on.
const config = (cards: boolean): PublicConfig => ({
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: { card_attendance: cards, fees: true, results: true, attendance: true },
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
});
const coordinator = fakeSession({ status: "signedIn", me: { id: "user-1", name: "Co-ordinator", roles: [{ role: "coordinator", scope: "institution" }] } });
const panel = (cards: boolean, canManage = true) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config(cards))}>
      <SessionContext.Provider value={coordinator}>
        <CardPanel owner="students" id={"a".repeat(32)} canManage={canManage} titled />
      </SessionContext.Provider>
    </ConfigContext.Provider>,
  );

const withCard: CardView = {
  owner: { kind: "student", name: "Sita Sharma" },
  current: { cardNumber: "04A1B2C3", issuedAt: "2026-10-17T05:00:00.000Z", issuedOnBs: "2083-07-01", usable: true },
  history: [{ cardNumber: "0099887766", issuedAt: "2026-09-01T05:00:00.000Z", retiredAt: "2026-10-01T05:00:00.000Z", retiredOnBs: "2083-06-15", reason: "Lost on the bus" }],
};

describe("the card on a record", () => {
  it("shows the number, that it is in use, and the cards retired before it with their reasons", () => {
    const html = renderToStaticMarkup(<CardFacts card={withCard} />);
    expect(html).toContain("04A1B2C3");
    expect(html).toContain("In use");
    expect(html).toContain("0099887766");
    expect(html).toContain("Lost on the bus");
  });

  it("says plainly when there is no card yet, and shows no history", () => {
    const html = renderToStaticMarkup(<CardFacts card={{ owner: withCard.owner, current: null, history: [] }} />);
    expect(html).toContain("No card linked yet.");
    expect(html).not.toContain("Earlier cards");
  });

  it("says a card does not count while its owner is no longer active", () => {
    const html = renderToStaticMarkup(<CardFacts card={{ ...withCard, current: { ...withCard.current!, usable: false } }} />);
    expect(html).toContain("Not in use");
    expect(html).toContain("does not count");
  });
});

describe("the panel", () => {
  it("is left out entirely where the school does not use cards", () => {
    expect(panel(false)).toBe("");
  });

  it("holds its place while it loads, with no heading or button until it knows the person may see it", () => {
    const html = panel(true);
    expect(html).toContain("skeleton");
    expect(html).not.toContain("ID card"); // the heading waits, so a person who may not see cards is never shown an empty one
    expect(html).not.toContain("Link card");
  });
});
