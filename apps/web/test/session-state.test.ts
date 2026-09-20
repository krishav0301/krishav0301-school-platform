import { describe, expect, it } from "vitest";

import { afterServerSignOut } from "@/session/SessionProvider";

describe("afterServerSignOut", () => {
  it("tells someone who WAS signed in that their session ended", () => {
    expect(afterServerSignOut({ status: "signedIn" })).toEqual({ status: "signedOut", me: null, ended: true });
  });

  it("does not tell a first-time visitor anything: no session was ever there to end", () => {
    expect(afterServerSignOut({ status: "checking" })).toEqual({ status: "signedOut", me: null, ended: false });
    expect(afterServerSignOut({ status: "signedOut" })).toEqual({ status: "signedOut", me: null, ended: false });
  });
});
