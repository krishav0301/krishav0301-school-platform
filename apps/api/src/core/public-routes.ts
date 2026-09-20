/**
 * Every route open to anonymous users, listed in one place. A test fails if a route is declared
 * public and is not listed here, so the public surface can only grow through a reviewed change
 * to this file.
 */
export const PUBLIC_ROUTES: ReadonlySet<string> = new Set(["GET /api/health"]);
