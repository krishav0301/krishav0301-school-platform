/**
 * Time-based one-time codes (RFC 6238), through the `otpauth` library: SHA-1, 6 digits, 30 seconds,
 * which is what Google Authenticator, Microsoft Authenticator, Authy and 1Password all speak. We do
 * not write any of the algorithm ourselves.
 */
import * as OTPAuth from "otpauth";

const DIGITS = 6;
const PERIOD = 30;
/** Codes from one step before or after now are accepted, for a phone clock that is a little off. */
const WINDOW = 1;

const toTotp = (secret: string, label?: { account: string; issuer: string }) =>
  new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    digits: DIGITS,
    period: PERIOD,
    algorithm: "SHA1",
    ...(label ? { label: label.account, issuer: label.issuer } : {}),
  });

/** A new random secret: 160 bits, in base32 (what authenticator apps take as a "setup key"). */
export function newTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

/** The `otpauth://` address an authenticator app scans as a QR code or opens as a link. */
export function otpauthUri(input: { secret: string; account: string; issuer: string }): string {
  return toTotp(input.secret, { account: input.account, issuer: input.issuer }).toString();
}

/**
 * The time step the code belongs to if it is valid now (or one step either side), otherwise null.
 * The caller must remember the step and refuse it (and any earlier one) next time, so a code
 * seen once, such as one read over someone's shoulder, cannot be used again.
 */
export function verifyTotp(secret: string, code: string, nowMs: number = Date.now()): number | null {
  const token = code.replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${DIGITS}}$`).test(token)) return null;
  const delta = toTotp(secret).validate({ token, timestamp: nowMs, window: WINDOW });
  if (delta === null) return null;
  return Math.floor(nowMs / 1000 / PERIOD) + delta;
}
