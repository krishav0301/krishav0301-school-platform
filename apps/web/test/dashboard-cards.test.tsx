import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SchoolDayCard, StudentTodayCard, TeacherTodayCard, TodayList } from "@/dashboard/TodayCards";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: royal.sections,
  modules: { attendance: true, teacher_attendance: true, homework: true, notes: true },
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
};
const as = (role: string, scope: "institution" | "own" | "assigned") => fakeSession({ status: "signedIn", me: { name: "Asha", roles: [{ role, scope }] } });
const inContext = (element: React.ReactNode, session = as("teacher", "assigned")) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={session}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

describe("the dashboard's today cards", () => {
  it("each shows the shape of its lines while it loads", () => {
    expect(inContext(<TeacherTodayCard />)).toMatch(/role="status"[^>]*aria-busy="true"/);
    expect(inContext(<StudentTodayCard />, as("student", "own"))).toMatch(/role="status"[^>]*aria-busy="true"/);
    expect(inContext(<SchoolDayCard />, as("coordinator", "institution"))).toMatch(/role="status"[^>]*aria-busy="true"/);
  });

  it("a line is a fact and the link to act on it; with nothing to do, it says so", () => {
    const html = inContext(<TodayList lines={[{ key: "a", text: "Today's register is not marked yet", href: "/portal/attendance", action: "Mark register" }]} />);
    expect(html).toContain("Today&#x27;s register is not marked yet");
    expect(html).toContain('href="/portal/attendance"');
    expect(html).toContain("Mark register");
    expect(inContext(<TodayList lines={[]} />)).toContain("Nothing needs you right now.");
  });
});
