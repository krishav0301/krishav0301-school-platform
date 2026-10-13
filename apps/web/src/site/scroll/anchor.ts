/** The section a link like `/#admission` points to, or null for anything that is not a plain section name. */
export const anchorFromHash = (hash: string): string | null => {
  const match = /^#([a-z][a-z0-9-]{0,40})$/.exec(hash);
  return match ? match[1]! : null;
};
