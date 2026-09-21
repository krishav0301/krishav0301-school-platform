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

/** The whole content of an item. The rules that involve more than one field are checked here. */
export const ContentInputSchema = z
  .object({
    kind: ContentKindSchema,
    title: Title,
    body: Body,
    /** Vacancies only: the email or phone to contact. */
    contact: Contact.nullable(),
    urgent: z.boolean(),
    publishOn: CalendarDaySchema,
    hideAfter: CalendarDaySchema.nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "vacancy" && value.contact === null) {
      ctx.addIssue({ code: "custom", path: ["contact"], message: "A vacancy needs an email or phone to contact" });
    }
    if (value.kind !== "vacancy" && value.contact !== null) {
      ctx.addIssue({ code: "custom", path: ["contact"], message: "Only a vacancy has a contact" });
    }
    if (value.hideAfter !== null && value.hideAfter < value.publishOn) {
      ctx.addIssue({ code: "custom", path: ["hideAfter"], message: "It cannot be hidden before it is shown" });
    }
  });
export type ContentInput = z.infer<typeof ContentInputSchema>;

/** What a person may change afterwards. The kind never changes; the status changes only by publishing and taking down. */
export type ContentChanges = Partial<Omit<ContentInput, "kind">>;

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
  })
  .openapi("PublicContentItem");
export type PublicContentItem = z.infer<typeof PublicContentItemSchema>;

export const PublicContentSchema = z.object({ items: z.array(PublicContentItemSchema) }).openapi("PublicContent");
export type PublicContent = z.infer<typeof PublicContentSchema>;
