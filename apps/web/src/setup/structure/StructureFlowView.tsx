"use client";

import { ChevronDown, Maximize2, Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { t } from "@/i18n/messages";

import { layoutTree, type StructNode } from "./model";
import { ICONS, kindWord, metaLine, nodeTitle, type Words } from "./parts";
import styles from "./structure.module.css";

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.6;
const STEP = 0.1;
const clamp = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));

/** The zoom buttons: in, out, fit the chart's width to the screen, and back to full size. */
export function FlowControls({ zoom, onZoom, onFit, onReset }: { zoom: number; onZoom: (zoom: number) => void; onFit: () => void; onReset: () => void }) {
  return (
    <div className={styles.controls} role="group" aria-label={t("structure.zoom")}>
      <button type="button" className={styles.control} aria-label={t("structure.zoom.out")} disabled={zoom <= MIN_ZOOM} onClick={() => onZoom(clamp(zoom - STEP))}>
        <Minus aria-hidden />
      </button>
      <span className={styles.zoomLevel} aria-live="polite">
        {t("structure.zoom.level", { n: Math.round(zoom * 100) })}
      </span>
      <button type="button" className={styles.control} aria-label={t("structure.zoom.in")} disabled={zoom >= MAX_ZOOM} onClick={() => onZoom(clamp(zoom + STEP))}>
        <Plus aria-hidden />
      </button>
      <button type="button" className={styles.control} aria-label={t("structure.zoom.fit")} onClick={onFit}>
        <Maximize2 aria-hidden />
      </button>
      <button type="button" className={styles.control} aria-label={t("structure.zoom.reset")} onClick={onReset}>
        <RotateCcw aria-hidden />
      </button>
    </div>
  );
}

/** One box of the chart: its kind, name and counts; pressing it shows its details, and its arrow opens or closes what is inside. */
export function FlowNode({ node, words, open, selected, onSelect, onToggle }: { node: StructNode; words: Words; open: boolean; selected: boolean; onSelect: () => void; onToggle: () => void }) {
  const Icon = ICONS[node.kind];
  const title = nodeTitle(node);
  return (
    <div className={styles.node} data-kind={node.kind} data-selected={selected || undefined} data-node-id={node.id}>
      <button type="button" className={styles.nodeMain} aria-pressed={selected} aria-label={t("structure.details", { kind: kindWord(node.kind, words), name: title })} onClick={onSelect}>
        <span className={styles.nodeIcon} aria-hidden>
          <Icon />
        </span>
        <span className={styles.nodeText}>
          <span className={styles.nodeKind}>{kindWord(node.kind, words)}</span>
          <span className={styles.nodeName}>{title}</span>
          <span className={styles.nodeMeta}>{metaLine(node)}</span>
        </span>
      </button>
      {node.children.length > 0 ? (
        <button type="button" className={styles.nodeToggle} aria-expanded={open} aria-label={t(open ? "structure.close" : "structure.open", { name: title })} onClick={onToggle}>
          <ChevronDown aria-hidden data-open={open} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * The chart (D-157): the open part of the structure, top down, with elbow connectors from each box to the ones inside it.
 * Positions come from the layout, never from fixed coordinates; the zoom scales the whole chart by transform.
 */
export function StructureFlowView({ root, open, selectedId, words, onSelect, onToggle }: { root: StructNode; open: ReadonlySet<string>; selectedId: string | null; words: Words; onSelect: (id: string) => void; onToggle: (id: string) => void }) {
  const layout = useMemo(() => layoutTree(root, open), [root, open]);
  const [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const nodes = useMemo(() => {
    const out: StructNode[] = [];
    const walk = (n: StructNode) => {
      if (!layout.boxes.has(n.id)) return;
      out.push(n);
      n.children.forEach(walk);
    };
    walk(root);
    return out;
  }, [root, layout]);

  // A box chosen elsewhere (a search result, a breadcrumb) is brought into view.
  useEffect(() => {
    if (!selectedId) return;
    const el = viewport.current?.querySelector(`[data-node-id="${CSS.escape(selectedId)}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [selectedId, layout]);

  const fit = () => {
    const width = viewport.current?.clientWidth ?? layout.width;
    setZoom(clamp(Math.min(1, width / layout.width)));
    viewport.current?.scrollTo({ left: 0, top: 0 });
  };

  return (
    <div className={styles.flow}>
      <FlowControls
        zoom={zoom}
        onZoom={setZoom}
        onFit={fit}
        onReset={() => {
          setZoom(1);
          viewport.current?.scrollTo({ left: 0, top: 0 });
        }}
      />
      <div ref={viewport} className={styles.viewport} role="region" tabIndex={0} aria-label={t("structure.canvas")}>
        <div style={{ width: layout.width * zoom, height: layout.height * zoom }}>
          <div className={styles.canvas} style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}>
            <svg className={styles.edges} width={layout.width} height={layout.height} aria-hidden>
              {layout.edges.map((e) => {
                const a = layout.boxes.get(e.from)!;
                const b = layout.boxes.get(e.to)!;
                const x1 = a.x + a.w / 2;
                const y1 = a.y + a.h;
                const x2 = b.x + b.w / 2;
                const mid = y1 + (b.y - y1) / 2;
                return <path key={`${e.from}>${e.to}`} d={`M ${x1} ${y1} V ${mid} H ${x2} V ${b.y}`} />;
              })}
            </svg>
            {nodes.map((n) => {
              const box = layout.boxes.get(n.id)!;
              return (
                <div key={n.id} className={styles.slot} style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
                  <FlowNode node={n} words={words} open={open.has(n.id)} selected={n.id === selectedId} onSelect={() => onSelect(n.id)} onToggle={() => onToggle(n.id)} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <p className={styles.hint}>{t("structure.hint")}</p>
    </div>
  );
}

