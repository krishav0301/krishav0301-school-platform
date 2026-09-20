/**
 * Every word the interface shows lives here, in one catalog (CLAUDE.md section 7). Components ask
 * for a key and never contain sentences. Nepali is added later as a second catalog with the same
 * keys; the toggle is not built yet. `{name}` marks a value filled in at the call.
 *
 * Words a school may rename (Student, Co-ordinator, Terminal, ...) are NOT here: they come from the
 * school's configuration (`useConfig().term(...)`).
 */
export const en = {
  // Shell
  "app.defaultTitle": "School",
  "shell.skipToContent": "Skip to main content",
  "shell.mainNavigation": "Main navigation",
  "shell.accountMenu": "Account",
  "shell.signIn": "Sign in",
  "shell.signOut": "Sign out",
  "shell.signedInAs": "Signed in as {name}",
  "shell.footer": "{school}",
  "nav.dashboard": "Dashboard",

  // Loading and status of the school configuration
  "config.loading": "Loading…",
  "config.unprovisionedTitle": "This site is not set up yet",
  "config.unprovisionedBody": "The school's details have not been added. Please check back soon.",
  "config.unreachableTitle": "Cannot reach the server",
  "config.unreachableBody": "Check your internet connection and try again.",
  "config.retry": "Try again",

  // Public home (a placeholder until the public website in Phase 2)
  "home.welcome": "Welcome to {school}",
  "home.intro": "The school website is being built. Students and staff can sign in below.",

  // Sign in
  "signIn.title": "Sign in",
  "signIn.subtitle": "to {school}",
  "signIn.email": "Email",
  "signIn.password": "Password",
  "signIn.submit": "Sign in",
  "signIn.submitting": "Signing in…",
  "signIn.invalid": "The email or password is not correct.",
  "signIn.throttled": "Too many attempts. Please wait a few minutes and try again.",
  "signIn.network": "Could not reach the server. Check your connection and try again.",
  "signIn.unexpected": "Something went wrong. Please try again.",
  "signIn.required": "Enter your email and password.",

  // Portal
  "portal.welcome": "Welcome, {name}",
  "portal.checking": "Checking your session…",
  "portal.yourAccount": "Your account",
  "portal.roles": "Your roles",
  "portal.scopeInstitution": "whole institution",
  "portal.scopeSection": "{section} only",
  "portal.scopeOwn": "own records",
  "portal.scopeAssigned": "assigned classes",
  "portal.support": "Support",
  "portal.nothingYet": "Nothing to show here yet. New sections appear as they are added.",
  "portal.sessionEnded": "Your session has ended. Please sign in again.",
} as const;

export type MessageKey = keyof typeof en;

/** The text for a key, with `{name}`-style values filled in. */
export function t(key: MessageKey, values?: Record<string, string | number>): string {
  const text: string = en[key];
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}
