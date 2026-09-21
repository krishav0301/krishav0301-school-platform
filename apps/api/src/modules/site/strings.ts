/**
 * The few words the server copy of a public page uses (D-046). The app's own words live in the web
 * catalog (`apps/web/src/i18n/messages.ts`); these are the same words for the same things, kept here
 * because the Worker cannot import the web app. A web test (`site-strings.test.ts`) checks that every
 * key in `SHARED_KEYS` says exactly what the catalog says, so the two cannot drift apart. Nepali comes
 * with the language toggle.
 */
export const STRINGS = {
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
  "site.programmes.title": "Programmes",
  "site.admission.title": "Admission",
  "site.scholarships.title": "Scholarships",
  "site.facilities.title": "Facilities",
  "site.contact.title": "Contact",
} as const;

export type StringKey = keyof typeof STRINGS;

/** Words for crawlers only, with no counterpart in the app. */
export const CRAWLER_ONLY = {
  "notices.description": "Notices, holidays, routines and vacancies from {school}.",
  "llms.pages": "Pages",
  "llms.contact": "Contact",
  "llms.home": "Home",
  "llms.homeSummary": "The home page of {school}: its programmes, how to apply and how to get in touch.",
  "site.programmes.description": "The programmes offered by {school}, with their levels, affiliations and durations.",
  "site.admission.description": "How to apply to {school}: the admission steps, from enquiry to enrolment.",
  "site.scholarships.description": "Scholarships offered by {school} and who can apply.",
  "site.facilities.description": "The facilities at {school}.",
  "site.contact.description": "The address and phone numbers of {school}.",
  "site.admission.howTo": "How to apply to {school}",
  "site.home.apply": "How to apply",
  "site.home.seeProgrammes": "See every programme",
  "site.home.seeAdmission": "Read the full admission process",
  "site.home.seeContact": "See all contact details",
  "site.affiliation": "Affiliation",
  "site.duration": "Duration",
  "site.options": "Options",
  "site.address": "Address",
  "site.phone": "Phone",
  "site.email": "Email",
  "site.hours": "Office hours",
} as const;

/** Every key that also exists in the web catalog, and so must match it. */
export const SHARED_KEYS = Object.keys(STRINGS) as StringKey[];

export function say(key: StringKey | keyof typeof CRAWLER_ONLY, values: Record<string, string> = {}): string {
  const text: string = key in STRINGS ? STRINGS[key as StringKey] : CRAWLER_ONLY[key as keyof typeof CRAWLER_ONLY];
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? values[name]! : whole));
}
