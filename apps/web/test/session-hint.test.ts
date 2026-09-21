import { describe, expect, it } from "vitest";

import { hasSessionHint } from "@/session/hint";
import { settleWithoutHint, type SessionState } from "@/session/SessionProvider";

describe("hasSessionHint: reads the hint cookie the server sets at sign-in", () => {
  it("is true when the hint is there, alone or among other cookies", () => {
    expect(hasSessionHint("__Host-signed-in=1")).toBe(true);
    expect(hasSessionHint("theme=dark; __Host-signed-in=1; other=x")).toBe(true);
    expect(hasSessionHint("__Host-signed-in=1; other=x")).toBe(true);
  });

  it("is false when there are no cookies, or none of them is the hint", () => {
    for (const none of ["", "theme=dark", "other=x; another=y"]) expect(hasSessionHint(none), JSON.stringify(none)).toBe(false);
  });

  it("does not mistake a similar cookie for it", () => {
    for (const lookalike of ["x__Host-signed-in=1", "__Host-signed-in-not=1", "__Host-signed-in=0", "__Host-signed-in=", "__Host-signed-in=10", "signed-in=1", "__Host-signed-in"]) {
      expect(hasSessionHint(lookalike), lookalike).toBe(false);
    }
  });
});

describe("settleWithoutHint: a visitor with no hint is signed out at once, with no request to ask", () => {
  const checking: SessionState = { status: "checking", me: null, ended: false };
  const signedIn: SessionState = { status: "signedIn", me: { name: "Asha", roles: [] }, ended: false };
  const signedOut: SessionState = { status: "signedOut", me: null, ended: true };

  it("no hint while still checking: signed out, with nothing to say about a session having ended", () => {
    expect(settleWithoutHint(checking, false)).toEqual({ status: "signedOut", me: null, ended: false });
  });

  it("a hint, or not knowing yet (the page built at deploy time), leaves the check to happen", () => {
    expect(settleWithoutHint(checking, true)).toBe(checking);
    expect(settleWithoutHint(checking, null)).toBe(checking);
  });

  it("never overrides what is already known: someone just signed in stays signed in, someone signed out stays so", () => {
    expect(settleWithoutHint(signedIn, false)).toBe(signedIn);
    expect(settleWithoutHint(signedOut, false)).toBe(signedOut);
  });
});
