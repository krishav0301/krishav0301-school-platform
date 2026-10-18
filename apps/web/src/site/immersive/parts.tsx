import type { ElementType } from "react";

import { photoUrl } from "@/site/scroll/photos";

import styles from "./immersive.module.css";
import { splitAccent } from "./model";

/** A heading with its accent word drawn in the accent colour (the pack marks it with stars). */
export function AccentHeading({ text, as: Tag = "h2", className }: { text: string; as?: ElementType; className?: string }) {
  const { before, accent, after } = splitAccent(text);
  return (
    <Tag className={[styles.heading, className].filter(Boolean).join(" ")}>
      {before}
      {accent ? <span className={styles.accent}>{accent}</span> : null}
      {after}
    </Tag>
  );
}

export interface Picture {
  file: string;
  alt: string;
}

/**
 * One of the school's pictures, from its own folder of static files. It fills a box whose shape the stylesheet fixes, so
 * the page does not jump when it arrives; it loads late unless it is the first thing on screen.
 */
export function Photo({ folder, picture, className, priority = false }: { folder: string | undefined; picture: Picture; className?: string; /** True for the picture that is first on screen: it loads at once. */ priority?: boolean }) {
  if (!folder) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a pre-sized WebP in a static export
    <img src={photoUrl(folder, picture.file)} alt={picture.alt} className={className} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : undefined} decoding="async" />
  );
}
