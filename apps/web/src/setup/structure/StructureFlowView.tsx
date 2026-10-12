"use client";

import { ChevronDown, Maximize2, Minus, Plus, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";

import { t } from "@/i18n/messages";
import { RowMenu, type MenuAction } from "@/ui";
import { StatusWord } from "@/read/ReadView";

import { layoutTree, type Layout, type StructNode } from "./model";
import { ICONS, kindWord, metaParts, nodeTitle, subjectChips, type Words } from "./parts";
import styles from "./structure.module.css";

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.6;
const STEP = 0.1;
const clamp = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));

/** Each wing in turn takes one of these colours, so neighbours can be told apart; every other kind keeps its own. */
export const WING_TONES = ["bad", "primary", "ok", "accent", "warn"] as const;

/** The zoom buttons: out, the level, in, fit the chart's width to the screen, and back to full size. */
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

/** The counts of a box, set apart by thin dividers; the text is cut at two lines so it never leaves the box. */
export function MetaLine({ parts }: { parts: readonly string[] }) {
  const missing = t("setup.map.noClassTeacher");
  return (
    <span className={styles.nodeMeta}>
      {parts.map((p, i) => (
        <span key={i} className={styles.metaPart} data-missing={p === missing || undefined}>
          {p}
        </span>
      ))}
    </span>
  );
}

/**
 * One box of the chart: a tinted card with the kind's icon, its kind, name and counts; pressing it shows its details, its
 * arrow opens or closes what is inside, and its three dots hold what else can be done. A dashed box leads to adding one.
 */
export function FlowNode({
  node,
  words,
  tone,
  open,
  selected,
  actions,
  onSelect,
  onToggle,
}: {
  node: StructNode;
  words: Words;
  tone?: string;
  open: boolean;
  selected: boolean;
  actions: MenuAction[];
  onSelect: () => void;
  onToggle: () => void;
}) {
  const Icon = ICONS[node.kind];
  const title = nodeTitle(node, words);
  if (node.payload.kind === "add") {
    return (
      <Link href={node.payload.href} className={styles.addNode} data-node-id={node.id}>
        <Icon aria-hidden />
        {title}
      </Link>
    );
  }
  const status = node.payload.kind === "term" ? node.payload.term.status : null;
  const names = node.payload.kind === "subjects" ? node.payload.level.subjects.map((s) => s.name) : [];
  const chips = subjectChips(names);
  return (
    <div className={styles.node} data-kind={node.kind} data-tone={tone} data-selected={selected || undefined} data-node-id={node.id}>
      <button type="button" className={styles.nodeMain} aria-pressed={selected} aria-label={t("structure.details", { kind: kindWord(node.kind, words), name: title })} onClick={onSelect}>
        <span className={styles.nodeIcon} aria-hidden>
          <Icon />
        </span>
        <span className={styles.nodeText}>
          <span className={styles.nodeKind}>
            {kindWord(node.kind, words)}
            {status ? <StatusWord tone={status === "active" ? "ok" : "neutral"}>{t(status === "active" ? "setup.map.active" : "setup.map.draft")}</StatusWord> : null}
          </span>
          <span className={styles.nodeName} title={title}>
            {node.kind === "subjects" ? `${title} (${names.length})` : title}
          </span>
          {node.kind === "subjects" ? (
            <span className={styles.subjectChips}>
              {chips.shown.map((n) => (
                <span key={n} className={styles.subjectChip}>
                  {n}
                </span>
              ))}
              {chips.more > 0 ? <span className={styles.subjectChip}>{t("structure.more", { n: chips.more })}</span> : null}
            </span>
          ) : (
            <MetaLine parts={metaParts(node)} />
          )}
        </span>
      </button>
      <div className={styles.nodeSide}>
        <RowMenu label={t("structure.menu", { name: title })} actions={actions} />
        {node.children.length > 0 ? (
          <button type="button" className={styles.nodeToggle} aria-expanded={open} aria-label={t(open ? "structure.close" : "structure.open", { name: title })} onClick={onToggle}>
            <ChevronDown aria-hidden data-open={open} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** A small picture of the whole chart with the part on screen outlined; pressing it moves there. Shown only when the chart is bigger than the screen. */
export function Minimap({ layout, zoom, view, onJump }: { layout: Layout; zoom: number; view: { left: number; top: number; w: number; h: number }; onJump: (x: number, y: number) => void }) {
  const W = 168;
  const H = 104;
  const scale = Math.min(W / layout.width, H / layout.height);
  return (
    <svg
      className={styles.minimap}
      width={layout.width * scale}
      height={layout.height * scale}
      role="img"
      aria-label={t("structure.minimap")}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onJump((e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
      }}
    >
      {[...layout.boxes.entries()].map(([id, b]) => (
        <rect key={id} className={styles.minimapBox} x={b.x * scale} y={b.y * scale} width={b.w * scale} height={b.h * scale} rx={2} />
      ))}
      <rect className={styles.minimapView} x={(view.left / zoom) * scale} y={(view.top / zoom) * scale} width={(view.w / zoom) * scale} height={(view.h / zoom) * scale} />
    </svg>
  );
}

/**
 * The chart (D-157): the open part of the structure, top down, with elbow connectors from each box to the ones inside it.
 * Positions come from the layout, never from fixed coordinates; the zoom scales the whole chart by transform.
 */
export function StructureFlowView({
  root,
  open,
  selectedId,
  words,
  actionsFor,
  onSelect,
  onToggle,
}: {
  root: StructNode;
  open: ReadonlySet<string>;
  selectedId: string | null;
  words: Words;
  actionsFor: (node: StructNode) => MenuAction[];
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const layout = useMemo(() => layoutTree(root, open), [root, open]);
  const [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ left: 0, top: 0, w: 0, h: 0 });
  // The window on the chart: where it is scrolled and how big it is, kept for the small map. Only a change counts, so it never loops.
  const measure = useCallback((el: HTMLDivElement) => {
    setView((now) => {
      const next = { left: el.scrollLeft, top: el.scrollTop, w: el.clientWidth, h: el.clientHeight };
      return now.left === next.left && now.top === next.top && now.w === next.w && now.h === next.h ? now : next;
    });
  }, []);
  // Read now and whenever the window changes size (one function for the life of the chart, or React would call it again at every draw).
  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      viewport.current = el;
      if (!el) return;
      measure(el);
      const watcher = new ResizeObserver(() => measure(el));
      watcher.observe(el);
      return () => watcher.disconnect();
    },
    [measure],
  );
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
  const wingTone = new Map(root.children.filter((n) => n.kind === "wing").map((n, i) => [n.id, WING_TONES[i % WING_TONES.length]!]));
  const toneOf = (n: StructNode) => (n.kind === "wing" ? wingTone.get(n.id) : root.kind === "wing" && n.id === root.id ? WING_TONES[0] : undefined);

  const fit = () => {
    const width = viewport.current?.clientWidth ?? layout.width;
    setZoom(clamp(Math.min(1, width / layout.width)));
    viewport.current?.scrollTo({ left: 0, top: 0 });
  };
  const bigger = view.w > 0 && (layout.width * zoom > view.w + 1 || layout.height * zoom > view.h + 1);

  return (
    <div className={styles.flow}>
      <div className={styles.tools}>
        <FlowControls
          zoom={zoom}
          onZoom={setZoom}
          onFit={fit}
          onReset={() => {
            setZoom(1);
            viewport.current?.scrollTo({ left: 0, top: 0 });
          }}
        />
        {bigger ? (
          <Minimap
            layout={layout}
            zoom={zoom}
            view={view}
            onJump={(x, y) => viewport.current?.scrollTo({ left: x * zoom - view.w / 2, top: y * zoom - view.h / 2, behavior: "smooth" })}
          />
        ) : null}
      </div>
      <div ref={attach} className={styles.viewport} role="region" tabIndex={0} aria-label={t("structure.canvas")} onScroll={(e) => measure(e.currentTarget)}>
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
                  <FlowNode node={n} words={words} tone={toneOf(n)} open={open.has(n.id)} selected={n.id === selectedId} actions={actionsFor(n)} onSelect={() => onSelect(n.id)} onToggle={() => onToggle(n.id)} />
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
