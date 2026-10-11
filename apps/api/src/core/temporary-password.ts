/**
 * The one-time password given to a new person, or to someone who has forgotten theirs (D-059). It is a secret: the caller
 * shows it once and stores only its hash, and it must never reach the audit log, a log line or the outbox.
 *
 * 4 digits (the PM, 2026-10-10), so it is easy to read out and type. That is only 10,000 possibilities, so it is limited
 * instead of long: it stops working 24 hours after it is issued (`temporary_password_expires_at`, set where it is issued) and after 3 wrong tries
 * (`TEMPORARY_PASSWORD_TRIES`), checked at sign-in; and the person must change it before they get a session.
 */
export const TEMPORARY_PASSWORD_TRIES = 3;

const LENGTH = 4;

export function generateTemporaryPassword(): string {
  // A byte at or above 250 is skipped: taking `byte % 10` from all 256 values would make 0 to 5 likelier.
  let chosen = "";
  while (chosen.length < LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < 250 && chosen.length < LENGTH) chosen += String(byte % 10);
    }
  }
  return chosen;
}
