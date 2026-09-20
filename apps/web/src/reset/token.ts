/**
 * The reset link is `/reset-password#token=...`. The token sits after the `#` on purpose: a browser
 * never sends that part to any server, so it cannot end up in a request log or a Referer header.
 * This reads it, and refuses anything that is not shaped like one of our tokens (43 base64url
 * characters), so a mangled or hostile fragment is treated as "no token".
 */
export function tokenFromHash(hash: string): string | null {
  const match = /^#token=([A-Za-z0-9_-]{16,200})$/.exec(hash);
  return match ? match[1]! : null;
}
