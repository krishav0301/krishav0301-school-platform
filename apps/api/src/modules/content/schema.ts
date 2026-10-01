import { z } from "@hono/zod-openapi";

/** `post` reads "News" on screen (D-098); its key is kept so nothing stored or linked has to change. */
export const CONTENT_KINDS = ["notice", "holiday", "routine", "vacancy", "post", "event", "information"] as const;
export const ContentKindSchema = z.enum(CONTENT_KINDS).openapi("ContentKind");
export type ContentKind = z.infer<typeof ContentKindSchema>;

/** A calendar day, AD, "YYYY-MM-DD", by Nepal's clock. Checked against the real calendar. */
export const CalendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the form YYYY-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "That day does not exist");

/** A time of day by Nepal's clock, 24-hour "HH:MM" (D-098). */
export const TimeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use the form HH:MM");

const Title = z.string().trim().min(1, "Give it a title").max(200, "Keep the title to 200 characters");
const Body = z.string().trim().min(1, "Write some text").max(10_000, "Keep the text to 10,000 characters");
const Contact = z.string().trim().min(1, "Give an email or phone").max(200, "Keep the contact to 200 characters");

/** The last day of a holiday: its own last day, or its one day. */
export const holidayEnd = (value: { holidayFrom: string | null; holidayTo: string | null }): string | null => value.holidayTo ?? value.holidayFrom;

interface CrossFields {
  kind: ContentKind;
  contact: string | null;
  publishOn: string;
  hideAfter: string | null;
  holidayFrom: string | null;
  holidayTo: string | null;
}

/** The rules that involve more than one field. */
function crossFieldRules(value: CrossFields, ctx: z.RefinementCtx) {
  if (value.kind === "vacancy" && value.contact === null) {
    ctx.addIssue({ code: "custom", path: ["contact"], message: "A vacancy needs an email or phone to contact" });
  }
  if (value.kind !== "vacancy" && value.contact !== null) {
    ctx.addIssue({ code: "custom", path: ["contact"], message: "Only a vacancy has a contact" });
  }
  if (value.kind === "holiday") {
    // A holiday names its own day (D-094). It comes off the site after its last day, so "hide after" is not
    // the person's to set (the schema sets it), and it must start showing on or before the holiday.
    if (value.holidayFrom === null) {
      ctx.addIssue({ code: "custom", path: ["holidayFrom"], message: "Give the date of the holiday" });
      return;
    }
    if (value.holidayTo !== null && value.holidayTo < value.holidayFrom) {
      ctx.addIssue({ code: "custom", path: ["holidayTo"], message: "The last day cannot be before the holiday starts" });
    } else if (value.publishOn > holidayEnd(value)!) {
      ctx.addIssue({ code: "custom", path: ["publishOn"], message: "Show it on or before the holiday" });
    }
    return;
  }
  if (value.holidayFrom !== null || value.holidayTo !== null) {
    ctx.addIssue({ code: "custom", path: ["holidayFrom"], message: "Only a holiday has holiday dates" });
  }
  if (value.hideAfter !== null && value.hideAfter < value.publishOn) {
    ctx.addIssue({ code: "custom", path: ["hideAfter"], message: "It cannot be hidden before it is shown" });
  }
}

const Fields = {
  title: Title,
  body: Body,
  /** Vacancies only: the email or phone to contact. */
  contact: Contact.nullable(),
  urgent: z.boolean(),
  publishOn: CalendarDaySchema,
  /** The time of day it starts showing, Nepal time (D-098). */
  publishTime: TimeOfDaySchema,
  hideAfter: CalendarDaySchema.nullable(),
  /** Holidays only (D-094): the day the school is closed, and the last day of a longer holiday. */
  holidayFrom: CalendarDaySchema.nullable(),
  holidayTo: CalendarDaySchema.nullable(),
};

/**
 * The whole content of an item. The service checks every write against this. A holiday comes off the site
 * after its last day: whatever "hide after" was sent for it is replaced by that day (D-094).
 */
export const ContentInputSchema = z
  .object({
    kind: ContentKindSchema,
    ...Fields,
    // Left out means midnight: an item shows from the start of its day, as before D-098.
    publishTime: Fields.publishTime.default("00:00"),
    // Left out means none, so a caller writing any other kind need not mention them.
    holidayFrom: Fields.holidayFrom.default(null),
    holidayTo: Fields.holidayTo.default(null),
  })
  .superRefine(crossFieldRules)
  .transform((value) => (value.kind === "holiday" ? { ...value, hideAfter: holidayEnd(value) } : value));
export type ContentInput = z.input<typeof ContentInputSchema>;

/** What the Admin sends to make an item. The optional parts may be left out. Anything else in the body is refused. */
export const CreateContentSchema = z
  .strictObject({
    kind: ContentKindSchema,
    title: Title,
    body: Body,
    contact: Contact.nullable().default(null),
    urgent: z.boolean().default(false),
    publishOn: CalendarDaySchema,
    publishTime: TimeOfDaySchema.default("00:00"),
    hideAfter: CalendarDaySchema.nullable().default(null),
    holidayFrom: CalendarDaySchema.nullable().default(null),
    holidayTo: CalendarDaySchema.nullable().default(null),
  })
  .superRefine(crossFieldRules)
  .openapi("CreateContent");

/**
 * What a person may change afterwards: any of these, and nothing else (a body with the kind or the
 * status in it is refused). The whole is checked again against what is already there.
 */
export const ContentChangesSchema = z.strictObject(Fields).partial().openapi("ContentChanges");
export type ContentChanges = z.infer<typeof ContentChangesSchema>;

/** A holiday's first and last day (D-094), AD and in Bikram Sambat. Null for every other kind, and for a holiday saved before D-094. */
const HolidayDates = {
  holidayFrom: CalendarDaySchema.nullable(),
  holidayTo: CalendarDaySchema.nullable(),
  holidayFromBs: z.string().nullable(),
  holidayToBs: z.string().nullable(),
};

/** Where an item stands today, in plain words for the Admin screen. */
export const CONTENT_STATES = ["draft", "waiting", "scheduled", "showing", "expired", "archived"] as const;
export const ContentStateSchema = z.enum(CONTENT_STATES).openapi("ContentState");
export type ContentState = z.infer<typeof ContentStateSchema>;

/**
 * The four groups the screen filters by (D-098): on the website now, not yet visible (draft or waiting for
 * approval), live but not yet at its day and time, and no longer shown (archived, or past its hide-after day).
 */
export const CONTENT_GROUPS = ["published", "draft", "scheduled", "archived"] as const;
export const ContentGroupSchema = z.enum(CONTENT_GROUPS).openapi("ContentGroup");
export type ContentGroup = z.infer<typeof ContentGroupSchema>;
export const STATES_OF_GROUP: Record<ContentGroup, readonly ContentState[]> = {
  published: ["showing"],
  draft: ["draft", "waiting"],
  scheduled: ["scheduled"],
  archived: ["archived", "expired"],
};

/** What the Admin screen gets: the public words plus where the item stands. Never who wrote it. */
export const AdminContentItemSchema = z
  .object({
    id: z.string(),
    kind: ContentKindSchema,
    title: z.string(),
    body: z.string(),
    contact: z.string().nullable(),
    urgent: z.boolean(),
    status: z.enum(["draft", "waiting", "live", "archived"]),
    state: ContentStateSchema,
    publishOn: CalendarDaySchema,
    publishTime: TimeOfDaySchema,
    hideAfter: CalendarDaySchema.nullable(),
    /** The same days in Bikram Sambat, "YYYY-MM-DD". Null for a day outside the verified BS years. */
    publishOnBs: z.string().nullable(),
    hideAfterBs: z.string().nullable(),
    ...HolidayDates,
    createdAt: z.string(),
    updatedAt: z.string(),
    publishedAt: z.string().nullable(),
    archivedAt: z.string().nullable(),
    /** Who wrote it: their name, or null for the build team, which the school sees as "Support" (CLAUDE.md section 5). */
    authorName: z.string().nullable(),
  })
  .openapi("AdminContentItem");
export type AdminContentItem = z.infer<typeof AdminContentItemSchema>;

/** The list gets everything except the text and the contact, which come with one item; only the text's first 200 characters, for a one-line excerpt (D-098). */
export const AdminContentSummarySchema = AdminContentItemSchema.omit({ body: true, contact: true })
  .extend({ excerpt: z.string().describe("The first 200 characters of the text, marks included.") })
  .openapi("AdminContentSummary");
export type AdminContentSummary = z.infer<typeof AdminContentSummarySchema>;

/** The four figures at the top of the screen (D-098), over every item, whatever the filters. */
export const ContentCountsSchema = z
  .object({
    /** On the website now. */
    published: z.number().int(),
    /** Not visible yet: drafts and items waiting for approval. */
    drafts: z.number().int(),
    /** Published, to show from a later day or time. */
    scheduled: z.number().int(),
    /** Urgent and on the website now or scheduled. */
    urgent: z.number().int(),
  })
  .openapi("ContentCounts");

export const AdminContentSchema = z
  .object({
    /** One page of the items that match, most recently touched first. */
    items: z.array(AdminContentSummarySchema),
    /** How many items match the filters and search, across every page. */
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    counts: ContentCountsSchema,
    /** The public website: its address, whether this is the real one, and when anything on it was last published. */
    site: z.object({ address: z.string().nullable(), live: z.boolean(), lastPublishedAt: z.string().nullable() }),
    /** Today in Bikram Sambat by Nepal's clock, "YYYY-MM-DD": what a new item's publish day starts as. Null once today is past the verified BS years. */
    todayBs: z.string().nullable(),
    /** The time now by Nepal's clock, "HH:MM": what a new item's publish time starts as. */
    nowTime: TimeOfDaySchema,
  })
  .openapi("AdminContent");

/** What the public site gets. Nothing internal (who wrote it, its status) is in it. */
export const PublicContentItemSchema = z
  .object({
    id: z.string(),
    kind: ContentKindSchema,
    title: z.string(),
    body: z.string().describe("Text with a few marks (D-098): a blank line starts a paragraph; **bold**, *italic*, __underline__, [a link](https://…), lines starting \"- \" or \"1. \" make a list, and \"## \" a heading. Nothing else is interpreted."),
    contact: z.string().nullable(),
    urgent: z.boolean(),
    publishedOn: CalendarDaySchema,
    hideAfter: CalendarDaySchema.nullable(),
    /** The same days in Bikram Sambat, "YYYY-MM-DD". Null for a day outside the verified BS years. */
    publishedOnBs: z.string().nullable(),
    hideAfterBs: z.string().nullable(),
    ...HolidayDates,
  })
  .openapi("PublicContentItem");
export type PublicContentItem = z.infer<typeof PublicContentItemSchema>;

export const PublicContentSchema = z.object({ items: z.array(PublicContentItemSchema) }).openapi("PublicContent");
export type PublicContent = z.infer<typeof PublicContentSchema>;
