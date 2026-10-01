/**
 * Routes with no permission action, each listed here. A test fails if a route is declared this
 * way and is not listed, so these surfaces can only grow through a reviewed change to this file.
 */

/** Open to anonymous users. */
export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  "GET /api/health",
  // The school's name, wording and theme. The web app needs it before anyone signs in, and it is
  // the same for every visitor. Nothing private is in it.
  "GET /api/config/public",
  // Date conversion between BS and AD. A pure function of its input, no data behind it. Screens ask
  // here because only the date module may convert (D-014).
  "GET /api/dates/to-ad",
  "GET /api/dates/to-bs",
  // Sign-in and the session endpoints identify the caller themselves (credentials or the
  // refresh cookie), and are rate-limited and locked out (see modules/auth).
  "POST /api/auth/sign-in",
  "POST /api/auth/refresh",
  "POST /api/auth/sign-out",
  // Password reset: the emailed token (256 random bits, single use) is the credential. The request
  // endpoint answers identically for unknown addresses and is rate-limited per account and address.
  "POST /api/auth/password-reset/request",
  "POST /api/auth/password-reset/confirm",
  // The second step of sign-in. The credential is the challenge token from a correct password (signed,
  // five minutes, not a session), and wrong codes are locked out together with password attempts.
  "POST /api/auth/2fa/verify",
  "POST /api/auth/2fa/setup",
  "POST /api/auth/2fa/enable",
  // Choosing a password after a temporary one. The credential is the challenge from a correct temporary password
  // (signed, five minutes, works once, not a session); it opens nothing else, and no other challenge opens this.
  "POST /api/auth/password/change-required",
  // Confirms an applicant's email from the emailed link. The credential is the token (256 random
  // bits, hash-only, single-use, 24 hours), the same shape as password reset's own confirm step.
  "POST /api/admissions/verify",
  // The payment gateway's notice (D-076). Its body is never trusted: the payment is confirmed by asking the gateway
  // itself, server to server, and applied once per gateway reference. Answers 404 unless a gateway is configured
  // (only the demo adapter, in demo mode, until Phase 9).
  "POST /api/fees/gateway/callback",
]);

/** Any signed-in user, whatever their role. For things people do to their own account. */
export const AUTHENTICATED_ROUTES: ReadonlySet<string> = new Set([
  "GET /api/auth/me",
  // Settings (D-091): your own account, never anyone else's. Each acts only on the signed-in person's own row.
  "GET /api/account/profile",
  "POST /api/auth/password/change",
]);
