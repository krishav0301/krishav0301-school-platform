/**
 * Where a school's photos are served from: static files in the web app (R2 is not enabled, D-020).
 * OPEN: the folder is Lahan's own for now; a second school with this layout gets its folder named in its pack.
 */
export const photoUrl = (file: string): string => `/site/lahan/${file}`;
