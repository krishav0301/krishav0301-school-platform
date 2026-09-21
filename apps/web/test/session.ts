import { createApiClient } from "@/api/client";
import type { SessionValue } from "@/session/SessionProvider";

/** A session for rendering tests: signed out, and every action succeeds unless the test says otherwise. */
export const fakeSession = (overrides: Partial<SessionValue> = {}): SessionValue => ({
  status: "signedOut",
  me: null,
  endedUnexpectedly: false,
  signIn: async () => ({ ok: true }),
  verifyTwoFactor: async () => ({ ok: true }),
  startTwoFactorSetup: async () => ({ ok: true, secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", otpauthUri: "otpauth://totp/Example:someone@school.example?secret=JBSWY3DPEHPK3PXP" }),
  enableTwoFactor: async () => ({ ok: true, recoveryCodes: [], me: { name: "Someone", roles: [] } }),
  acceptSession: () => {},
  signOut: async () => {},
  // No network in rendering tests: any call fails the way an offline browser does.
  api: createApiClient({ fetch: async () => { throw new TypeError("offline"); } }),
  ...overrides,
});
