"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, type PointerEvent } from "react";

import { t } from "@/i18n/messages";

import styles from "./immersive.module.css";
import { Photo, type Picture } from "./parts";

export interface FacilityTile {
  name: string;
  body?: string;
  picture?: Picture;
}

/**
 * The facilities as a row of large tiles that moves sideways: dragged with a mouse or a finger, moved with the two buttons,
 * or with the arrow keys once the row has focus. The row is the browser's own scrolling with snap points, so it works
 * without script and under reduced motion; the buttons only scroll it by a tile. A tile with no picture is a gradient
 * drawn in CSS.
 */
export function FacilityGallery({ tiles, folder }: { tiles: FacilityTile[]; folder: string | undefined }) {
  const row = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);

  const step = (direction: 1 | -1) => {
    const el = row.current;
    if (!el) return;
    const tile = el.querySelector<HTMLElement>("[data-tile]");
    el.scrollBy({ left: direction * ((tile?.offsetWidth ?? el.clientWidth * 0.8) + 16), behavior: "smooth" });
  };

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || !row.current) return;
    drag.current = { x: event.clientX, left: row.current.scrollLeft, moved: false };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !row.current) return;
    const delta = event.clientX - d.x;
    if (Math.abs(delta) > 4) d.moved = true;
    row.current.scrollLeft = d.left - delta;
  };
  const up = () => {
    drag.current = null;
  };

  return (
    <div className={styles.galleryFrame}>
      <div
        ref={row}
        role="region"
        aria-label={t("immersive.facilities.label")}
        tabIndex={0}
        className={styles.gallery}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") step(1);
          if (event.key === "ArrowLeft") step(-1);
        }}
      >
        {tiles.map((tile) => (
          <article key={tile.name} data-tile data-photo={tile.picture ? "true" : "false"} className={styles.tile}>
            {tile.picture ? <Photo folder={folder} picture={tile.picture} className={styles.tilePhoto} /> : null}
            <div className={styles.tileText}>
              <h3>{tile.name}</h3>
              {tile.body ? <p>{tile.body}</p> : null}
            </div>
          </article>
        ))}
      </div>
      <div className={styles.galleryButtons}>
        <button type="button" className={styles.galleryButton} aria-label={t("immersive.facilities.previous")} onClick={() => step(-1)}>
          <ChevronLeft aria-hidden />
        </button>
        <button type="button" className={styles.galleryButton} aria-label={t("immersive.facilities.next")} onClick={() => step(1)}>
          <ChevronRight aria-hidden />
        </button>
      </div>
    </div>
  );
}
