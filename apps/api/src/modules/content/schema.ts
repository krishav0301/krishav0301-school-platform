import { z } from "@hono/zod-openapi";

export const CONTENT_KINDS = ["notice", "holiday", "routine", "vacancy", "post"] as const;
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

const Title = z.string().trim().min(1, "Give it a title").max(200, "Keep the title to 200 characters");
const Body = z.string().trim().min(1, "Write some text").max(10_000, "Keep the text to 10,000 characters");
const Contact = z.string().trim().min(1, "Give an email or phone").max(200, "Keep the contact to 200 characters");

/** The rules that involve more than one field. */
function crossFieldRules(value: { kind: ContentKind; contact: string | null; publishOn: string; hideAfter: string | null }, ctx: z.RefinementCtx) {
  if (value.kind === "vacancy" && value.contact === null) {
    ctx.addIssue({ code: "custom", path: ["contact"], message: "A vacancy needs an email or phone to contact" });
  }
  if (value.kind !== "vacancy" && value.contact !== null) {
    ctx.addIssue({ code: "custom", path: ["contact"], message: "Only a vacancy has a contact" });
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
  hideAfter: CalendarDaySchema.nullable(),
};

/** The whole content of an item. The service checks every write against this. */
export const ContentInputSchema = z.object({ kind: ContentKindSchema, ...Fields }).superRefine(crossFieldRules);
export type ContentInput = z.infer<typeof ContentInputSchema>;

/** What the Admin sends to make an item. The optional parts may be left out. Anything else in the body is refused. */
export const CreateContentSchema = z
  .strictObject({
    kind: ContentKindSchema,
    title: Title,
    body: Body,
    contact: Contact.nullable().default(null),
    urgent: z.boolean().default(false),
    publishOn: CalendarDaySchema,
    hideAfter: CalendarDaySchema.nullable().default(null),
  })
  .superRefine(crossFieldRules)
  .openapi("CreateContent");

/**
 * What a person may change afterwards: any of these, and nothing else (a body with the kind or the
 * status in it is refused). The whole is checked again against what is already there.
 */
export const ContentChangesSchema = z.strictObject(Fields).partial().openapi("ContentChanges");
export type ContentChanges = z.infer<typeof ContentChangesSchema>;

/** Where an item stands today, in plain words for the Admin screen. */
export const CONTENT_STATES = ["draft", "waiting", "scheduled", "showing", "expired"] as const;
export const ContentStateSchema = z.enum(CONTENT_STATES).openapi("ContentState");
export type ContentState = z.infer<typeof ContentStateSchema>;

/** What the Admin screen gets: the public words plus where the item stands. Never who wrote it. */
export const AdminContentItemSchema = z
  .object({
    id: z.string(),
    kind: ContentKindSchema,
    title: z.string(),
    body: z.string(),
    contact: z.string().nullable(),
    urgent: z.boolean(),
    status: z.enum(["draft", "waiting", "live"]),
    state: ContentStateSchema,
    publishOn: CalendarDaySchema,
    hideAfter: CalendarDaySchema.nullable(),
    /** The same days in Bikram Sambat, "YYYY-MM-DD". Null for a day outside the verified BS years. */
    publishOnBs: z.string().nullable(),
    hideAfterBs: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    publishedAt: z.string().nullable(),
  })
  .openapi("AdminContentItem");
export type AdminContentItem = z.infer<typeof AdminContentItemSchema>;

/** The list gets everything except the text and the contact, which come with one item. */
export const AdminContentSummarySchema = AdminContentItemSchema.omit({ body: true, contact: true }).openapi("AdminContentSummary");
export type AdminContentSummary = z.infer<typeof AdminContentSummarySchema>;

export const AdminContentSchema = z
  .object({
    items: z.array(AdminContentSummarySchema),
    /** Today in Bikram Sambat by Nepal's clock, "YYYY-MM-DD": what a new item's publish day starts as. Null once today is past the verified BS years. */
    todayBs: z.string().nullable(),
  })
  .openapi("AdminContent");

/** What the public site gets. Nothing internal (who wrote it, its status) is in it. */
export const PublicContentItemSchema = z
  .object({
    id: z.string(),
    kind: ContentKindSchema,
    title: z.string(),
    body: z.string().describe("Plain text. A blank line starts a new paragraph."),
    contact: z.string().nullable(),
    urgent: z.boolean(),
    publishedOn: CalendarDaySchema,
    hideAfter: CalendarDaySchema.nullable(),
    /** The same days in Bikram Sambat, "YYYY-MM-DD". Null for a day outside the verified BS years. */
    publishedOnBs: z.string().nullable(),
    hideAfterBs: z.string().nullable(),
  })
  .openapi("PublicContentItem");
export type PublicContentItem = z.infer<typeof PublicContentItemSchema>;

export const PublicContentSchema = z.object({ items: z.array(PublicContentItemSchema) }).openapi("PublicContent");
export type PublicContent = z.infer<typeof PublicContentSchema>;
