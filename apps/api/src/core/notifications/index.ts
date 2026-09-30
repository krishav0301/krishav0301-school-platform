/**
 * Notifications (D-034). One outbox event per message; a job delivers it. Only email exists so
 * far (SMS is a Phase 9 adapter). Templates are plain text, short, and written here in one place.
 * `OPEN:` move the wording into the message catalog when Nepali is added.
 */
import { createEmailAdapter } from "../email";
import { drainOutbox, enqueue, enqueueIf, type DrainResult, type Handler } from "../jobs";
import type { Bindings } from "../types";

export const EMAIL_EVENT = "email";

export type EmailTemplate = "password_reset" | "admission_verify" | "admission_decision" | "fee_overdue";

export interface EmailPayload {
  template: EmailTemplate;
  to: string;
  data: Record<string, string>;
}

export interface RenderContext {
  schoolName: string;
  /** The address people use to reach the site, like https://school.example. */
  siteOrigin: string;
}

/** A token is base64url. Anything else could change what a link points to, so it is refused. */
const SAFE_TOKEN = /^[A-Za-z0-9_-]{1,200}$/;

export function renderEmail(payload: EmailPayload, context: RenderContext): { subject: string; body: string } {
  if (payload.template === "password_reset") {
    const token = payload.data.token;
    if (typeof token !== "string" || !SAFE_TOKEN.test(token)) throw new Error("The password reset email needs a plain token.");
    const link = `${context.siteOrigin.replace(/\/+$/, "")}/reset-password#token=${token}`;
    return {
      subject: `Reset your password for ${context.schoolName}`,
      body: [
        `Someone asked to reset the password for your account at ${context.schoolName}.`,
        "",
        "To choose a new password, open this link. It works once and expires in 1 hour:",
        link,
        "",
        "If you did not ask for this, ignore this message. Your password will not change.",
      ].join("\n"),
    };
  }
  if (payload.template === "admission_verify") {
    const token = payload.data.token;
    if (typeof token !== "string" || !SAFE_TOKEN.test(token)) throw new Error("The admission verification email needs a plain token.");
    const link = `${context.siteOrigin.replace(/\/+$/, "")}/apply#token=${token}`;
    return {
      subject: `Confirm your application to ${context.schoolName}`,
      body: [
        `Thanks for applying to ${context.schoolName}.`,
        "",
        "To confirm your email and put your application in the queue, open this link:",
        link,
        "",
        "If you did not apply, ignore this message.",
      ].join("\n"),
    };
  }
  if (payload.template === "admission_decision") {
    const decision = payload.data.decision;
    if (decision === "approved") {
      return {
        subject: `You are admitted to ${context.schoolName}`,
        body: [
          `Congratulations — your application to ${context.schoolName} has been approved.`,
          `Your student id (SID) is ${payload.data.sid}.`,
          "",
          "Sign in with this email and the temporary password given to you, and choose your own password.",
        ].join("\n"),
      };
    }
    if (decision === "needs_changes") {
      return {
        subject: `A change is needed on your application to ${context.schoolName}`,
        body: [`${context.schoolName} asked for a change to your application:`, "", payload.data.reason, "", "Reply to this email, or visit the school, to make the change."].join("\n"),
      };
    }
    return {
      subject: `About your application to ${context.schoolName}`,
      body: [`${context.schoolName} was not able to approve your application.`, "", `Reason: ${payload.data.reason}`].join("\n"),
    };
  }
  if (payload.template === "fee_overdue") {
    // D-078: the amounts arrive already written in NPR with Nepali grouping; nothing here does arithmetic on money.
    return {
      subject: `Fees overdue at ${context.schoolName}`,
      body: [
        `Dear ${payload.data.name} (${payload.data.sid}),`,
        "",
        `NPR ${payload.data.overdue} of your fees is overdue at ${context.schoolName}.`,
        `You can see what is due, and your receipts, when you sign in: ${context.siteOrigin.replace(/\/+$/, "")}/portal`,
        "",
        "If you have paid in the last few days, please ignore this message.",
      ].join("\n"),
    };
  }
  throw new Error(`Unknown email template "${String(payload.template)}".`);
}

interface QueueEmail extends EmailPayload {
  /** The same key never produces two emails. */
  dedupeKey: string;
}

/** Queues an email. The payload is sealed: the address and the token are not readable in the queue. */
export function queueEmail(db: D1Database, dataKey: string, email: QueueEmail): Promise<D1PreparedStatement> {
  const { dedupeKey, ...payload } = email;
  return enqueue(db, { type: EMAIL_EVENT, payload, dedupeKey, sealKey: dataKey });
}

/** As `queueEmail`, but only if `conditionSql` returns a row (`?5`, `?6`, ... are `params`). */
export function queueEmailIf(db: D1Database, dataKey: string, email: QueueEmail, conditionSql: string, ...params: (string | number | null)[]): Promise<D1PreparedStatement> {
  const { dedupeKey, ...payload } = email;
  return enqueueIf(db, { type: EMAIL_EVENT, payload, dedupeKey, sealKey: dataKey }, conditionSql, ...params);
}

/** What the runner does with each kind of event. */
export function notificationHandlers(env: Pick<Bindings, "DB" | "EMAIL_ADAPTER" | "SITE_ORIGIN">): Record<string, Handler> {
  const sendEmail: Handler = async (payload, event) => {
    if (!env.SITE_ORIGIN) throw new Error("SITE_ORIGIN is not set, so links in emails cannot be built.");
    const school = await env.DB.prepare("SELECT name FROM school WHERE id = 1").first<{ name: string }>();
    if (!school) throw new Error("This school has not been set up, so an email cannot name it.");

    const email = payload as EmailPayload;
    const { subject, body } = renderEmail(email, { schoolName: school.name, siteOrigin: env.SITE_ORIGIN });
    await createEmailAdapter(env).send({ to: email.to, subject, body, idempotencyKey: event.dedupeKey ?? `outbox:${event.id}` });
  };
  return { [EMAIL_EVENT]: sendEmail };
}

/** Delivers whatever is due. Called right after a request that queued something, and by the cron sweep. */
export function runOutbox(env: Pick<Bindings, "DB" | "DATA_KEY" | "EMAIL_ADAPTER" | "SITE_ORIGIN">, now?: Date): Promise<DrainResult> {
  return drainOutbox(env.DB, notificationHandlers(env), { sealKey: env.DATA_KEY, now });
}
