/**
 * Whether a secret value shows up in some text as a value of its own. A temporary password is four digits, and four
 * digits turn up by chance inside a hash or a timestamp, so a plain `toContain` fails now and then for no reason. A
 * leaked password would stand alone (between quotes, spaces or punctuation), never inside a longer run of letters or digits.
 */
export function leaks(text: string, secret: string): boolean {
  const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![0-9A-Za-z])${escaped}(?![0-9A-Za-z])`).test(text);
}
