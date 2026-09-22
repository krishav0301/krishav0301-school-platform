/**
 * Private file storage behind short-lived signed links (an extension point, D-008). Not enabled yet
 * (D-020): R2 is off in every deployment, and no adapter exists. This is the seam only — the shape
 * a real adapter will take, so admissions and any other module can be written against it later
 * without a second design. `createFileStorage` always throws until the PM turns R2 on and a real
 * adapter is written alongside `core/email`'s "dev" adapter as the pattern to follow.
 *
 * Section 7's rules (check type by content, rename on save, 20 MB limit, serve from a separate
 * storage domain) belong to the adapter that does not exist yet, not to this interface.
 */

export interface StoredFile {
  key: string;
  contentType: string;
  size: number;
}

export interface SignedUrl {
  url: string;
  expiresAt: string;
}

export interface FileStorage {
  readonly name: string;
  put(key: string, data: ArrayBuffer, contentType: string): Promise<StoredFile>;
  signedGetUrl(key: string, ttlSeconds: number): Promise<SignedUrl>;
  remove(key: string): Promise<void>;
}

export function createFileStorage(): FileStorage {
  throw new Error("File storage is not enabled (D-020). No adapter exists until R2 is turned on and one is written.");
}
