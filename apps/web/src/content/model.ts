import type { components } from "@/api/schema";
import { t, type MessageKey } from "@/i18n/messages";

/**
 * The rules of the content form, kept apart from the screens so they can be tested without a
 * browser. They mirror what the server checks (`modules/content/schema.ts`), so a person hears about a
 * problem before anything is sent; the server still checks everything.
 */
/** One item with its text (the edit form), and the light form the list carries. */
export type ContentItem = components["schemas"]["AdminContentItem"];
export type ContentSummary = components["schemas"]["AdminContentSummary"];
export type Kind = ContentItem["kind"];
export type State = ContentItem["state"];

export const KINDS: readonly Kind[] = ["notice", "holiday", "routine", "vacancy", "post"];
export const STATES: readonly State[] = ["draft", "waiting", "scheduled", "showing", "expired"];

/** The words for each kind and state. Written out so every key is visibly in use. */
export const KIND_LABEL: Record<Kind, MessageKey> = {
  notice: "content.kind.notice",
  holiday: "content.kind.holiday",
  routine: "content.kind.routine",
  vacancy: "content.kind.vacancy",
  post: "content.kind.post",
};
export const STATE_LABEL: Record<State, MessageKey> = {
  draft: "content.state.draft",
  waiting: "content.state.waiting",
  scheduled: "content.state.scheduled",
  showing: "content.state.showing",
  expired: "content.state.expired",
};

/** Month 1 (Baisakh) to month 12 (Chaitra). */
export const MONTH_LABEL: readonly MessageKey[] = [
  "date.month.1", "date.month.2", "date.month.3", "date.month.4", "date.month.5", "date.month.6",
  "date.month.7", "date.month.8", "date.month.9", "date.month.10", "date.month.11", "date.month.12",
];

export const TITLE_MAX = 200;
export const BODY_MAX = 10_000;
export const CONTACT_MAX = 200;

/** What the form holds. Days are Nepali (Bikram Sambat) text, "YYYY-MM-DD"; the server converts them. */
export interface FormValues {
  kind: Kind;
  title: string;
  body: string;
  contact: string;
  urgent: boolean;
  publishOnBs: string;
  hideAfterBs: string;
}

export type FieldName = "title" | "body" | "contact" | "publishOnBs" | "hideAfterBs";
export type FormErrors = Partial<Record<FieldName, MessageKey>>;

/** The order the fields appear in, so the first problem in the list is the first one on screen. */
const FIELD_ORDER: readonly FieldName[] = ["title", "body", "contact", "publishOnBs", "hideAfterBs"];

export const emptyForm = (todayBs: string | null, kind: Kind = "notice"): FormValues => ({
  kind,
  title: "",
  body: "",
  contact: "",
  urgent: false,
  publishOnBs: todayBs ?? "",
  hideAfterBs: "",
});

export const formFromItem = (item: Pick<ContentItem, "kind" | "title" | "body" | "contact" | "urgent" | "publishOnBs" | "hideAfterBs">): FormValues => ({
  kind: item.kind,
  title: item.title,
  body: item.body,
  contact: item.contact ?? "",
  urgent: item.urgent,
  publishOnBs: item.publishOnBs ?? "",
  hideAfterBs: item.hideAfterBs ?? "",
});

const BS_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export function validateForm(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  const title = values.title.trim();
  const body = values.body.trim();
  const contact = values.contact.trim();
  const publishOn = values.publishOnBs.trim();
  const hideAfter = values.hideAfterBs.trim();

  if (!title) errors.title = "contentForm.error.titleRequired";
  else if (title.length > TITLE_MAX) errors.title = "contentForm.error.titleTooLong";

  if (!body) errors.body = "contentForm.error.bodyRequired";
  else if (body.length > BODY_MAX) errors.body = "contentForm.error.bodyTooLong";

  // Only a vacancy has a contact. For every other kind the box is not shown, so it is not checked.
  if (values.kind === "vacancy") {
    if (!contact) errors.contact = "contentForm.error.contactRequired";
    else if (contact.length > CONTACT_MAX) errors.contact = "contentForm.error.contactTooLong";
  }

  if (!publishOn) errors.publishOnBs = "contentForm.error.dateRequired";
  else if (!BS_SHAPE.test(publishOn)) errors.publishOnBs = "contentForm.error.dateShape";

  if (hideAfter) {
    if (!BS_SHAPE.test(hideAfter)) errors.hideAfterBs = "contentForm.error.dateShape";
    // Zero-padded year-month-day text sorts in date order, so this compares the days without converting them.
    else if (!errors.publishOnBs && hideAfter < publishOn) errors.hideAfterBs = "contentForm.error.hideBeforeShow";
  }
  return errors;
}

export const firstInvalid = (errors: FormErrors): FieldName | null => FIELD_ORDER.find((name) => errors[name] !== undefined) ?? null;

/** A Nepali day as words, "5 Ashwin 2083". A dash when there is nothing sensible to show. */
export function formatBsDate(text: string | null | undefined): string {
  const match = text ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) : null;
  if (!match) return "—";
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 32) return "—";
  return `${day} ${t(MONTH_LABEL[month - 1]!)} ${year}`;
}

/** A Nepali day as the three pieces a person fills in, each as typed or chosen. */
export interface BsParts {
  year: string;
  month: string;
  day: string;
}

/** Splits "2083-06-05" into pieces. Anything that is not a whole day gives blank pieces. */
export function splitBs(text: string): BsParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return { year: "", month: "", day: "" };
  return { year: match[1]!, month: String(Number(match[2])), day: String(Number(match[3])) };
}

/**
 * Joins pieces into "YYYY-MM-DD". Nothing filled in gives an empty text (an optional day left empty).
 * Part of a day gives text that is not a whole day, so `validateForm` says a piece is missing. The month
 * and day are padded to two digits; a wrong year or day is kept as typed so it is reported, not fixed.
 */
export function joinBs({ year, month, day }: BsParts): string {
  const [y, m, d] = [year.trim(), month.trim(), day.trim()];
  if (!y && !m && !d) return "";
  const pad = (piece: string) => (piece.length === 1 ? `0${piece}` : piece);
  return `${y}-${pad(m)}-${pad(d)}`;
}

export type EditTarget = { mode: "new"; kind?: Kind } | { mode: "edit"; id: string } | { mode: "invalid" };

/**
 * What the edit page was asked to open, from its address (`?id=...`). No `id` is a new item; an id
 * that is not exactly 32 lowercase hex characters is invalid, and is never quietly treated as new.
 */
export function parseEditTarget(search: string): EditTarget {
  const params = new URLSearchParams(search);
  if (!params.has("id")) {
    // A new item may start as a known kind (`?kind=post`, the dashboard's Publish Post, D-089).
    const kind = params.get("kind");
    return kind !== null && (KINDS as readonly string[]).includes(kind) ? { mode: "new", kind: kind as Kind } : { mode: "new" };
  }
  const id = params.get("id") ?? "";
  return /^[0-9a-f]{32}$/.test(id) ? { mode: "edit", id } : { mode: "invalid" };
}

export type FlashKind = "created" | "updated" | "published" | "saved_unpublished";

/** What the list is told a form just did (`?done=created`). Anything else is ignored. */
export function parseFlash(search: string): FlashKind | null {
  const done = new URLSearchParams(search).get("done");
  return done === "created" || done === "updated" || done === "published" || done === "saved_unpublished" ? done : null;
}

/** The text split into paragraphs at blank lines. Nothing in it is interpreted: it is shown as typed. */
export const paragraphs = (body: string): string[] =>
  body
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);

/** What the public notice board shows for one item. */
export type PublicItem = components["schemas"]["PublicContentItem"];

/** The words for the filter buttons on the public board, one per kind, in the plural. */
export const KIND_PLURAL_LABEL: Record<Kind, MessageKey> = {
  notice: "notices.kind.notice",
  holiday: "notices.kind.holiday",
  routine: "notices.kind.routine",
  vacancy: "notices.kind.vacancy",
  post: "notices.kind.post",
};

const EMAIL = /^[^\s@<>"?;&]+@[^\s@<>"?;&]+\.[^\s@<>"?;&]+$/;
const PHONE = /^\+?[\d\s\-()]{7,24}$/;

/**
 * A link for a vacancy's contact, or null. Only an email address or a phone number becomes a link
 * (`mailto:` or `tel:`, built here from characters that were checked), so nothing an Admin types can
 * become a script or another kind of address. Anything else is shown as the plain text it is.
 */
export function contactHref(contact: string): string | null {
  const text = contact.trim();
  if (EMAIL.test(text)) return `mailto:${text}`;
  if (PHONE.test(text)) {
    const digits = text.replace(/\D/g, "");
    if (digits.length >= 7) return `tel:${text.startsWith("+") ? "+" : ""}${digits}`;
  }
  return null;
}
