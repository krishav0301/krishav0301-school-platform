import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ApplicantFields } from "@/admissions/ApplicantFields";
import { apply } from "@/admissions/client";
import { emptyApplicantForm, validateApplicant } from "@/admissions/model";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/apply", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: {},
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
};
const fields = (showEmail?: boolean) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <ApplicantFields values={emptyApplicantForm()} errors={{}} levels={[]} onChange={() => {}} showEmail={showEmail} />
    </ConfigContext.Provider>,
  );

const filled = { ...emptyApplicantForm(), firstName: "Anita", lastName: "Yadav", dobBs: "2070-01-01", phone: "9801234567", guardianName: "Ram", guardianPhone: "9801234567", levelId: "a".repeat(32) };

describe("the application form for a school that takes applications without an email link (D-168)", () => {
  it("draws no email field when asked not to, and still draws it by default", () => {
    expect(fields(false)).not.toMatch(/type="email"/);
    expect(fields()).toMatch(/type="email"/);
    expect(fields(true)).toMatch(/type="email"/);
  });

  it("does not ask for an email when it is not wanted, and does when it is", () => {
    expect(validateApplicant(filled, { email: false }).email).toBeUndefined();
    expect(validateApplicant(filled).email).toBe("admissions.error.email");
    expect(validateApplicant(filled, { email: true }).email).toBe("admissions.error.email");
  });

  it("sends no email when the field is left blank", async () => {
    let sent: Record<string, unknown> | undefined;
    const api = {
      POST: async (_path: string, init: { body: Record<string, unknown> }) => {
        sent = init.body;
        return { data: { id: "x" }, response: { status: 201 }, error: undefined };
      },
    };
    const result = await apply(api as never, filled, "2013-04-14", "token-token-token-1", "");
    expect(result).toEqual({ ok: true, id: "x" });
    expect(sent).toBeDefined();
    expect(sent!.email).toBeUndefined();
    expect(sent!.firstName).toBe("Anita");
  });
});
