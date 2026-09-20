/** Random, unguessable id for URLs and API responses. The integer id never leaves the database. */
export function newPublicId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
