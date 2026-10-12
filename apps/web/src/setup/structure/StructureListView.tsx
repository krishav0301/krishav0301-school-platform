"use client";

import { ChevronDown } from "lucide-react";

import { t } from "@/i18n/messages";

import type { StructNode } from "./model";
import { ICONS, kindWord, metaLine, nodeTitle, type Words } from "./parts";
import styles from "./structure.module.css";

/**
 * The same structure as nested rows (D-157), for scanning a large school or for a phone: each row is a name and its counts,
 * with an arrow that opens what is inside it. It shares the chart's open and chosen boxes, so switching views keeps the place.
 */
export function StructureListView({ root, open, selectedId, words, onSelect, onToggle }: { root: StructNode; open: ReadonlySet<string>; selectedId: string | null; words: Words; onSelect: (id: string) => void; onToggle: (id: string) => void }) {
  return (
    <ul className={styles.tree} role="tree" aria-label={t("structure.list")}>
      <ListRow node={root} depth={0} open={open} selectedId={selectedId} words={words} onSelect={onSelect} onToggle={onToggle} />
    </ul>
  );
}

function ListRow({ node, depth, open, selectedId, words, onSelect, onToggle }: { node: StructNode; depth: number; open: ReadonlySet<string>; selectedId: string | null; words: Words; onSelect: (id: string) => void; onToggle: (id: string) => void }) {
  const Icon = ICONS[node.kind];
  const isOpen = open.has(node.id);
  const title = nodeTitle(node);
  return (
    <li role="treeitem" aria-expanded={node.children.length > 0 ? isOpen : undefined} aria-selected={node.id === selectedId} data-node-id={node.id}>
      <div className={styles.row} data-kind={node.kind} data-selected={node.id === selectedId || undefined} style={{ paddingInlineStart: `calc(var(--space-3) + ${depth} * var(--space-5))` }}>
        {node.children.length > 0 ? (
          <button type="button" className={styles.rowToggle} aria-expanded={isOpen} aria-label={t(isOpen ? "structure.close" : "structure.open", { name: title })} onClick={() => onToggle(node.id)}>
            <ChevronDown aria-hidden data-open={isOpen} />
          </button>
        ) : (
          <span className={styles.rowToggle} aria-hidden />
        )}
        <button type="button" className={styles.rowMain} aria-label={t("structure.details", { kind: kindWord(node.kind, words), name: title })} onClick={() => onSelect(node.id)}>
          <span className={styles.nodeIcon} aria-hidden>
            <Icon />
          </span>
          <span className={styles.rowName}>
            <span className={styles.nodeKind}>{kindWord(node.kind, words)}</span> {title}
          </span>
          <span className={styles.nodeMeta}>{metaLine(node)}</span>
        </button>
      </div>
      {isOpen && node.children.length > 0 ? (
        <ul role="group">
          {node.children.map((c) => (
            <ListRow key={c.id} node={c} depth={depth + 1} open={open} selectedId={selectedId} words={words} onSelect={onSelect} onToggle={onToggle} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
