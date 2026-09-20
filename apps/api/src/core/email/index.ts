/**
 * Email goes out through an adapter (an extension point, D-008). The core never talks to an email
 * provider directly. Today there is only the "dev" adapter, which writes to a table so development
 * and staging can read what would have been sent. A real provider is a Phase 9 adapter, chosen and
 * paid for then; adding it changes this file and nothing else.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
  /** The same key must never produce two emails. A provider adapter passes it on as its idempotency key. */
  idempotencyKey: string;
}

export interface EmailAdapter {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_ADAPTERS = ["dev"] as const;
export type EmailAdapterName = (typeof EMAIL_ADAPTERS)[number];

/** Writes the message to `dev_mailbox`. Sending the same key twice stores it once. */
export function devEmailAdapter(db: D1Database): EmailAdapter {
  return {
    name: "dev",
    async send(message) {
      await db
        .prepare("INSERT OR IGNORE INTO dev_mailbox (at, idempotency_key, to_email, subject, body) VALUES (?1, ?2, ?3, ?4, ?5)")
        .bind(new Date().toISOString(), message.idempotencyKey, message.to, message.subject, message.body)
        .run();
    },
  };
}

/** The adapter this deployment is configured for. Throws if none is, so a missing setting is loud. */
export function createEmailAdapter(env: { DB: D1Database; EMAIL_ADAPTER?: string }): EmailAdapter {
  const name = env.EMAIL_ADAPTER;
  if (name === "dev") return devEmailAdapter(env.DB);
  throw new Error(name ? `Unknown EMAIL_ADAPTER "${name}". Known: ${EMAIL_ADAPTERS.join(", ")}.` : "No EMAIL_ADAPTER is configured, so email cannot be sent.");
}
