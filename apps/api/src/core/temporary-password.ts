/**
 * The one-time password given to a new person, or to someone who has forgotten theirs (D-059). It is a secret: the caller
 * shows it once and stores only its hash, and it must never reach the audit log, a log line or the outbox.
 *
 * 16 characters from an alphabet with no look-alikes (no 0, O, 1, I or L), written in four groups so it can be read out
 * and typed: XXXX-XXXX-XXXX-XXXX. That is about 79 bits, and the person must change it before they get a session.
 */
export const TEMPORARY_PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const LENGTH = 16;

export function generateTemporaryPassword(): string {
  // A byte at or above this limit is skipped: taking `byte % 31` from all 256 values would make the first characters likelier.
  const limit = 256 - (256 % TEMPORARY_PASSWORD_ALPHABET.length);
  let chosen = "";
  while (chosen.length < LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < limit && chosen.length < LENGTH) chosen += TEMPORARY_PASSWORD_ALPHABET[byte % TEMPORARY_PASSWORD_ALPHABET.length];
    }
  }
  return chosen.match(/.{4}/g)!.join("-");
}
