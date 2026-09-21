import { describe, expect, it } from "vitest";

import { changeFailureMessages, passwordChangeFailure } from "@/session/password-change";

describe("what the API's refusal means", () => {
  it("an expired or spent challenge is invalid_challenge", () => {
    expect(passwordChangeFailure(401, { error: "invalid_challenge" })).toEqual({ reason: "invalid_challenge" });
  });

  it("the temporary password again is 'same'", () => {
    expect(passwordChangeFailure(422, { error: "same_password" })).toEqual({ reason: "same" });
  });

  it("a weak password carries the reasons, keeping only the ones we have words for", () => {
    expect(passwordChangeFailure(422, { error: "weak_password", problems: ["too_short", "common"] })).toEqual({ reason: "weak", problems: ["too_short", "common"] });
    expect(passwordChangeFailure(422, { error: "weak_password", problems: ["too_short", "something_new", 7] })).toEqual({ reason: "weak", problems: ["too_short"] });
  });

  it("anything else is unexpected", () => {
    expect(passwordChangeFailure(500, {})).toEqual({ reason: "unexpected" });
    expect(passwordChangeFailure(401, { error: "something_else" })).toEqual({ reason: "unexpected" });
    expect(passwordChangeFailure(422, undefined)).toEqual({ reason: "unexpected" });
    expect(passwordChangeFailure(422, { error: "weak_password" })).toEqual({ reason: "unexpected" });
  });
});

describe("what to tell someone whose new password was not accepted", () => {
  it("names each weak-password reason in words, and stays on the step", () => {
    expect(changeFailureMessages({ reason: "weak", problems: ["too_short", "common"] })).toEqual({ keys: ["reset.weak.too_short", "reset.weak.common"], restart: false });
  });

  it("says the temporary password cannot be reused, and stays on the step", () => {
    expect(changeFailureMessages({ reason: "same" })).toEqual({ keys: ["signIn.samePassword"], restart: false });
  });

  it("an expired step sends the person back to the start; a dropped connection or a surprise stays", () => {
    expect(changeFailureMessages({ reason: "invalid_challenge" })).toEqual({ keys: ["twoFactor.expired"], restart: true });
    expect(changeFailureMessages({ reason: "network" })).toEqual({ keys: ["signIn.network"], restart: false });
    expect(changeFailureMessages({ reason: "unexpected" })).toEqual({ keys: ["signIn.unexpected"], restart: false });
  });
});
