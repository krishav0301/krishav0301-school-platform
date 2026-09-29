/**
 * Online payments go through a gateway adapter (an extension point, CLAUDE.md section 2). Only a demo adapter exists
 * (section 9: "Payment gateway, merchant account: not built; interface and demo adapter only"); a real one (eSewa,
 * Khalti, a bank) is a Phase 9 adapter with the school's own merchant account, and changes this file and nothing
 * else. Money never touches the operator.
 *
 * The rule every adapter keeps: a payment is confirmed by asking the gateway, server to server (`confirm`), never by
 * trusting what a browser or a callback says. The reference it returns is unique, and the ledger applies it once.
 */

export interface GatewayStart {
  /** The gateway's own reference for this payment. Unique; the ledger applies it at most once. */
  gatewayReference: string;
  /** Where to send the payer (a demo page here; the gateway's checkout for a real one). */
  redirectUrl: string;
}

export interface PaymentGateway {
  readonly name: string;
  /** Begins a payment of `amountPaisa` for our attempt `attemptPublicId`. */
  start(attemptPublicId: string, amountPaisa: number): Promise<GatewayStart>;
  /** Asks the gateway whether this reference was paid, and how much. Null when the gateway does not know it. */
  confirm(gatewayReference: string, known: { amountPaisa: number } | null): Promise<{ paid: boolean; amountPaisa: number } | null>;
}

/**
 * The demo adapter: no money moves. It "confirms" any reference it made, for the amount the attempt was made for.
 * Only available in demo mode, which the app refuses to start with in production (core/environment.ts).
 */
export const demoGateway: PaymentGateway = {
  name: "demo",
  async start(attemptPublicId) {
    const gatewayReference = `DEMO-${attemptPublicId}`;
    return { gatewayReference, redirectUrl: `/portal/fees?demo_payment=${encodeURIComponent(gatewayReference)}` };
  },
  async confirm(gatewayReference, known) {
    if (!gatewayReference.startsWith("DEMO-") || known === null) return null;
    return { paid: true, amountPaisa: known.amountPaisa };
  },
};

/** The gateway this deployment may use, or null: none until Phase 9, the demo one only in demo mode. */
export function paymentGateway(env: { DEMO_MODE?: string }): PaymentGateway | null {
  return env.DEMO_MODE === "true" ? demoGateway : null;
}
