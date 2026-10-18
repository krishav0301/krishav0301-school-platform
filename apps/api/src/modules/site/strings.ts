/**
 * The few words the server copy of a public page uses (D-046). The app's own words live in the web
 * catalog (`apps/web/src/i18n/messages.ts`); these are the same words for the same things, kept here
 * because the Worker cannot import the web app. A web test (`site-strings.test.ts`) checks that every
 * key in `SHARED_KEYS` says exactly what the catalog says, so the two cannot drift apart. Nepali comes
 * with the language toggle.
 */
export const STRINGS = {
  "shell.signIn": "Sign in",
  "notices.title": "Notices and updates",
  "notices.intro": "News, notices, holidays, events, routines, vacancies and information from the school.",
  "notices.empty": "Nothing to show right now. Check back soon.",
  "notices.posted": "Posted {date}",
  "notices.postedUntil": "Posted {from}, until {until}",
  "content.contact": "Contact:",
  "content.urgent": "Urgent",
  "content.kind.notice": "Notice",
  "content.kind.holiday": "Holiday",
  "content.kind.routine": "Routine",
  "content.kind.vacancy": "Vacancy",
  "content.kind.post": "News",
  "content.kind.event": "Event",
  "content.kind.information": "Information",
  "content.holidayOn": "Holiday on {date}",
  "content.holidayFromTo": "Holiday from {from} to {to}",
} as const;

export type StringKey = keyof typeof STRINGS;

/** Words for crawlers only, with no counterpart in the app. */
export const CRAWLER_ONLY = {
  "notices.description": "Notices, holidays, routines and vacancies from {school}.",
  "llms.pages": "Pages",
  "llms.contact": "Contact",
  "llms.home": "Home",
  "llms.homeSummary": "The home page of {school}: its programmes, how to apply and how to get in touch.",
  "llms.signInSummary": "The front page of {school}: a way to sign in.",
  "site.signIn.description": "Sign in to {school}.",
  "site.address": "Address",
  "site.phone": "Phone",
  "site.scroll.school": "The School",
  "site.immersive.scholarships": "Scholarships",
  "site.immersive.apply": "How to apply",
  "site.scroll.notices": "Notices",
  "site.scroll.about": "About the school",
  "site.scroll.facebook": "The school's Facebook page",
  "site.email": "Email",
  "site.hours": "Office hours",
} as const;

/** Every key that also exists in the web catalog, and so must match it. */
export const SHARED_KEYS = Object.keys(STRINGS) as StringKey[];

export function say(key: StringKey | keyof typeof CRAWLER_ONLY, values: Record<string, string> = {}): string {
  const text: string = key in STRINGS ? STRINGS[key as StringKey] : CRAWLER_ONLY[key as keyof typeof CRAWLER_ONLY];
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? values[name]! : whole));
}
