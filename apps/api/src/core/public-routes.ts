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
  // Sign-in and the session endpoints identify the caller themselves (credentials or the
  // refresh cookie), and are rate-limited and locked out (see modules/auth).
  "POST /api/auth/sign-in",
  "POST /api/auth/refresh",
  "POST /api/auth/sign-out",
]);

/** Any signed-in user, whatever their role. For things people do to their own account. */
export const AUTHENTICATED_ROUTES: ReadonlySet<string> = new Set(["GET /api/auth/me"]);
