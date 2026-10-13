/** Where a school's photos are served from: its own folder of static files in the web app (R2 is not enabled, D-020). */
export const photoUrl = (folder: string, file: string): string => `/site/${folder}/${file}`;
