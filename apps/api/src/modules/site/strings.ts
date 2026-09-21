/**
 * The few words the server copy of a public page uses (D-046). The app's own words live in the web
 * catalog (`apps/web/src/i18n/messages.ts`); these are the same words for the same things, kept here
 * because the Worker cannot import the web app. A web test (`site-strings.test.ts`) checks that every
 * key in `SHARED_KEYS` says exactly what the catalog says, so the two cannot drift apart. Nepali comes
 * with the language toggle.
 */
export const STRINGS = {
  "home.welcome": "Welcome to {school}",
  "home.notices": "Notices and updates",
  "shell.signIn": "Sign in",
  "notices.title": "Notices and updates",
  "notices.intro": "News, holidays, routines and vacancies from the school.",
  "notices.empty": "Nothing to show right now. Check back soon.",
  "notices.posted": "Posted {date}",
  "notices.postedUntil": "Posted {from}, until {until}",
  "content.contact": "Contact:",
  "content.urgent": "Urgent",
  "content.kind.notice": "Notice",
  "content.kind.holiday": "Holiday",
  "content.kind.routine": "Routine",
  "content.kind.vacancy": "Vacancy",
  "content.kind.post": "Post",
} as const;

export type StringKey = keyof typeof STRINGS;

/** Words for crawlers only, with no counterpart in the app. */
export const CRAWLER_ONLY = {
  "notices.description": "Notices, holidays, routines and vacancies from {school}.",
} as const;

/** Every key that also exists in the web catalog, and so must match it. */
export const SHARED_KEYS = Object.keys(STRINGS) as StringKey[];

export function say(key: StringKey | keyof typeof CRAWLER_ONLY, values: Record<string, string> = {}): string {
  const text: string = key in STRINGS ? STRINGS[key as StringKey] : CRAWLER_ONLY[key as keyof typeof CRAWLER_ONLY];
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? values[name]! : whole));
}
