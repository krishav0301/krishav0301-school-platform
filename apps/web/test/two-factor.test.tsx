import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import SignInPage from "@/app/sign-in/page";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SessionContext, twoFactorFailure } from "@/session/SessionProvider";
import { CodeStep, RecoveryCodesStep, SetupView, groupKey } from "@/two-factor/steps";
import royal from "../../../packs/royal-softech/pack.json";
import { fakeSession } from "./session";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: royal.sections,
  modules: {},
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
};

const render = (element: React.ReactNode) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={fakeSession()}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const URI = "otpauth://totp/Royal%20Softech%20College:help%40school.example?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Royal%20Softech%20College";

describe("groupKey", () => {
  it("writes the setup key in groups of four, as authenticator apps show it", () => {
    expect(groupKey(SECRET)).toBe("JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP");
    expect(groupKey("ABC")).toBe("ABC");
    expect(groupKey("")).toBe("");
  });
});

describe("twoFactorFailure", () => {
  it("tells apart a wrong code, an expired sign-in, too many tries, and anything else", () => {
    expect(twoFactorFailure(401, { error: "invalid_code" })).toBe("invalid_code");
    expect(twoFactorFailure(401, { error: "invalid_challenge" })).toBe("invalid_challenge");
    expect(twoFactorFailure(429, { error: "too_many_attempts" })).toBe("throttled");
    expect(twoFactorFailure(500, undefined)).toBe("unexpected");
    expect(twoFactorFailure(401, undefined)).toBe("unexpected");
    expect(twoFactorFailure(401, null)).toBe("unexpected");
    expect(twoFactorFailure(401, "text")).toBe("unexpected");
    expect(twoFactorFailure(400, { error: "invalid_code" })).toBe("unexpected"); // only a 401 means a wrong code
  });
});

describe("the code step", () => {
  const html = render(<CodeStep challenge="c" schoolName="Royal Softech College" onRestart={() => {}} onDifferentAccount={() => {}} />);

  it("says what to do and where the code comes from, naming the school", () => {
    expect(html).toMatch(/<h1[^>]*>Enter your code<\/h1>/);
    expect(html).toContain("Open your authenticator app and enter the 6-digit code for Royal Softech College.");
  });

  it("has a labelled code field, and a phone will offer the number keypad and the code from messages", () => {
    const tag = html.match(/<input[^>]*name="code"[^>]*>/)![0];
    const input = tag.toLowerCase(); // React writes autoComplete/inputMode; HTML ignores case
    const id = tag.match(/\sid="([^"]+)"/)![1];
    expect(html).toMatch(new RegExp(`<label for="${id}"[^>]*>Code</label>`));
    expect(input).toContain('autocomplete="one-time-code"');
    expect(input).toContain('inputmode="numeric"');
  });

  it("one prominent button, with the other choices quiet", () => {
    expect(html.match(/class="button primary/g)).toHaveLength(1);
    expect(html).toMatch(/class="button quiet full"[^>]*>Use a recovery code instead</);
    expect(html).toMatch(/class="button quiet full"[^>]*>Use a different account</);
  });

  it("every button that is not the submit button is type=button, so none can submit by accident", () => {
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(buttons.filter((b) => b.includes('type="submit"'))).toHaveLength(1);
    expect(buttons.filter((b) => !b.includes('type="submit"')).every((b) => b.includes('type="button"'))).toBe(true);
  });
});

describe("the setup step", () => {
  const html = render(<SetupView secret={SECRET} otpauthUri={URI} code="" onCode={() => {}} onSubmit={() => {}} submitting={false} problem={null} />);

  it("explains why, and names apps people know", () => {
    expect(html).toMatch(/<h1[^>]*>Set up two-step sign-in<\/h1>/);
    expect(html).toContain("Google Authenticator, Microsoft Authenticator or Authy");
  });

  it("shows the key in groups of four, selectable, with a way to copy it and a link that opens an app", () => {
    expect(html).toContain("JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP");
    expect(html).toContain("Copy key");
    expect(html).toMatch(/<a[^>]*href="otpauth:\/\/totp\/[^"]*"[^>]*>Open in authenticator app<\/a>/);
  });

  it("offers a QR code first, named for screen readers, with how to use it, and how to add the key by hand as the way round it", () => {
    expect(html).toMatch(/<svg[^>]*role="img"[^>]*aria-label="QR code that adds this account to an authenticator app"/);
    expect(html).toContain("Scan this code with the authenticator app on your phone.");
    expect(html).toContain("choose Enter a setup key");
    expect(html).toContain("Time based");
    expect(html.indexOf("<svg")).toBeLessThan(html.indexOf("JBSW Y3DP"));
    // Exactly one picture, and it does not repeat the key in text form.
    expect(html.match(/<svg/g)).toHaveLength(1);
  });

  it("announces the copy result to screen readers", () => {
    expect(html).toContain('role="status"');
  });

  it("asks for the first code with a labelled field and one prominent 'Turn on' button", () => {
    const tag = html.match(/<input[^>]*name="code"[^>]*>/)![0];
    const input = tag.toLowerCase();
    const id = tag.match(/\sid="([^"]+)"/)![1];
    expect(html).toMatch(new RegExp(`<label for="${id}"[^>]*>Code</label>`));
    expect(input).toContain('autocomplete="one-time-code"');
    expect(html.match(/class="button primary/g)).toHaveLength(1);
    expect(html).toContain("Turn on");
  });

  it("shows a problem in an alert, and a busy button while it works", () => {
    const failed = render(<SetupView secret={SECRET} otpauthUri={URI} code="123456" onCode={() => {}} onSubmit={() => {}} submitting problem="twoFactor.invalidCode" />);
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("That code is not right, or it was already used.");
    expect(failed).toContain('aria-busy="true"');
    expect(failed).toContain("Turning on…");
  });
});

describe("the recovery codes step", () => {
  const codes = ["abcde-fghjk", "mnpqr-stuvw", "xyz23-45678", "9abcd-efghj", "kmnpq-rstuv", "wxyz2-34567", "89abc-defgh", "jkmnp-qrstu", "vwxyz-23456", "789ab-cdefg"];
  const html = render(<RecoveryCodesStep codes={codes} onDone={() => {}} />);

  it("shows all ten codes, each on its own, and says they will not be shown again", () => {
    for (const code of codes) expect(html).toContain(`>${code}</code>`);
    expect(html.match(/<code/g)).toHaveLength(10);
    expect(html).toContain("You will not see them again.");
  });

  it("has a copy button and exactly one prominent button, the explicit 'I have saved these codes'", () => {
    expect(html).toContain("Copy codes");
    expect(html.match(/class="button primary/g)).toHaveLength(1);
    expect(html).toMatch(/class="button primary"[^>]*>I have saved these codes</);
  });

  it("does not put the codes anywhere but on the page text (no attributes, no links)", () => {
    for (const code of codes) expect(html.split(code)).toHaveLength(2); // exactly once
  });
});

describe("the sign-in page", () => {
  it("still opens on the password step; the second step appears only after the password is right", () => {
    const html = render(<SignInPage />);
    expect(html).toMatch(/<h1[^>]*>Sign in to Royal Softech College<\/h1>/);
    expect(html).not.toContain("Enter your code");
    expect(html).not.toContain("recovery");
  });
});
