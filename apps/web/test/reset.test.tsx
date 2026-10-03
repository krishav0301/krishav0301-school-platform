import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import ResetPasswordPage from "@/app/reset-password/page";
import SignInPage from "@/app/sign-in/page";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { NewPasswordForm, RequestForm } from "@/reset/ResetForms";
import { tokenFromHash } from "@/reset/token";
import { SessionContext, type SessionValue } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: {},
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
};
const session: SessionValue = fakeSession();

const inContext = (element: React.ReactNode) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={session}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

describe("tokenFromHash", () => {
  const good = "ORDdmB6_GNZ89IYiP-9mukYfN9iJq6slp0JRLabcdef";

  it("reads the token from the fragment of a reset link", () => {
    expect(tokenFromHash(`#token=${good}`)).toBe(good);
  });

  it.each([
    ["nothing", ""],
    ["a bare #", "#"],
    ["an empty token", "#token="],
    ["a different fragment", "#section=2"],
    ["a token that is too short to be ours", "#token=abc"],
    ["characters that are not base64url", "#token=abc def ghi jkl mno pqr"],
    ["a script", "#token=<script>alert(1)</script>"],
    ["extra fragments after the token", `#token=${good}&x=1`],
    ["an enormous token", `#token=${"a".repeat(500)}`],
    ["the token in a query string, where it does not belong", `?token=${good}`],
  ])("treats %s as no token", (_label, hash) => {
    expect(tokenFromHash(hash)).toBeNull();
  });
});

describe("the reset pages", () => {
  const request = inContext(<ResetPasswordPage />);

  it("open on the 'ask for a link' form: the server-built page has no token", () => {
    expect(request).toMatch(/<h1[^>]*>Reset your password<\/h1>/);
    expect(request).toContain("Send reset link");
  });

  it("the request form: one heading, a labelled email field, one prominent button, a way back", () => {
    const html = inContext(<RequestForm />);
    expect(html.match(/<h1/g)).toHaveLength(1);
    const id = html.match(/<input[^>]*\sid="([^"]+)"/)![1];
    expect(html).toMatch(new RegExp(`<label for="${id}"[^>]*>Email</label>`));
    expect(html).toContain('type="email"');
    expect(html.match(/class="button primary/g)).toHaveLength(1);
    expect(html).toMatch(/<a[^>]*href="\/sign-in"[^>]*>Back to sign in<\/a>/);
    expect(html.toLowerCase()).toContain('autocomplete="username"');
  });

  it("the header does not add a second Sign in next to the form", () => {
    expect(request.match(/href="\/sign-in"/g)?.length ?? 0).toBe(1); // only the form's own 'Back to sign in'
  });

  it("the new-password form: a new-password field (so password managers offer to save it), guidance up front, a Show toggle", () => {
    const html = inContext(<NewPasswordForm token="ORDdmB6_GNZ89IYiP-9mukYfN9iJq6slp0JRLabcdef" onLinkInvalid={() => {}} />);
    expect(html).toMatch(/<h1[^>]*>Choose a new password<\/h1>/);
    expect(html.toLowerCase()).toContain('autocomplete="new-password"');
    expect(html).toContain("At least 10 characters. Avoid common passwords and your school&#x27;s name.");
    expect(html).toContain('aria-label="Show password"');
    expect(html.match(/class="button primary/g)).toHaveLength(1);
    expect(html).toContain("Change password");
  });

  it("never puts the token in the markup", () => {
    const html = inContext(<NewPasswordForm token="ORDdmB6_GNZ89IYiP-9mukYfN9iJq6slp0JRLabcdef" onLinkInvalid={() => {}} />);
    expect(html).not.toContain("ORDdmB6_GNZ89IYiP");
  });

  it("the sign-in page offers 'Forgot your password?' as a quiet link, so it does not compete with Sign in", () => {
    const html = inContext(<SignInPage />);
    // It may wrap onto two lines at 320 px with text at 200% (admin FUT F-16), so it carries one more class.
    expect(html).toMatch(/<a[^>]*class="button quiet full wrapLink"[^>]*href="\/reset-password"[^>]*>Forgot your password\?<\/a>|<a[^>]*href="\/reset-password"[^>]*class="button quiet full wrapLink"[^>]*>Forgot your password\?<\/a>/);
    expect(html.match(/class="button primary/g)).toHaveLength(1);
  });
});
