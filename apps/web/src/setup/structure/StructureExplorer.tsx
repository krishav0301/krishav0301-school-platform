"use client";

import { Search, Settings } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState, useSyncExternalStore } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { Segments, StatusWord } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { Button, Select } from "@/ui";

import { canManageProgrammes, canManageStructure, termWords, type SetupMap } from "../model";
import { buildTree, closing, findNode, openingPath, pathTo, searchTree, type Hit } from "./model";
import { ICONS, kindWord, nodeTitle } from "./parts";
import { StructureDetail } from "./StructureDetail";
import { StructureFlowView } from "./StructureFlowView";
import { StructureListView } from "./StructureListView";
import styles from "./structure.module.css";

type View = "flow" | "list";

/** True on a phone-width screen, where the chart does not fit and the list takes its place. Read after load, so the page starts the same on server and browser. */
function useNarrow(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia("(max-width: 720px)");
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia("(max-width: 720px)").matches,
    () => false,
  );
}

/**
 * The Academic Structure (the PM, 2026-10-12, D-157): the school as a tree you open one branch at a time, as a chart or as
 * a list, with a way to search it, a path to where you are, focus on one wing or course, and a panel for the details of a
 * box. Open and closed boxes are only on this screen; nothing is saved.
 */
export function StructureExplorer({ map, termHref }: { map: SetupMap; termHref: string }) {
  const { term: word } = useConfig();
  const { me } = useSession();
  const words = termWords(word);
  const narrow = useNarrow();
  const [termChoice, setTermChoice] = useState<string | null>(null);
  const term = map.terms.find((x) => x.id === termChoice) ?? map.terms[0]!;
  const tree = useMemo(() => buildTree(term, t("setup.map.unnamedSection")), [term]);
  const [viewChoice, setViewChoice] = useState<View>("flow");
  const view: View = narrow ? "list" : viewChoice;
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set([tree.id]));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const roles = me?.roles ?? [];
  const reach = { structure: canManageStructure(roles), programmes: canManageProgrammes(roles) };
  const root = (focusId ? findNode(tree, focusId) : null) ?? tree;
  const selected = selectedId ? findNode(tree, selectedId) : null;
  const hits = searchTree(tree, query);

  // A change of term starts the page again; a term of its own is chosen by the person, never by the data.
  const chooseTerm = (id: string) => {
    const next = map.terms.find((x) => x.id === id) ?? map.terms[0]!;
    setTermChoice(id);
    setOpen(new Set([`term:${next.id}`]));
    setSelectedId(null);
    setDetailOpen(false);
    setFocusId(null);
    setQuery("");
  };

  const select = (id: string) => {
    setSelectedId(id);
    setDetailOpen(true);
    const node = findNode(tree, id);
    if (node && node.children.length > 0 && !open.has(id)) setOpen(openingPath(tree, id));
  };
  const toggle = (id: string) => setOpen(open.has(id) ? closing(tree, open, id) : openingPath(tree, id));
  const focusOn = (id: string | null) => {
    setFocusId(id);
    setOpen(openingPath(tree, id ?? tree.id));
    setDetailOpen(false);
  };
  const pick = (hit: Hit) => {
    const node = findNode(tree, hit.id);
    setFocusId(null);
    setOpen(openingPath(tree, node?.parentId ?? hit.id));
    setSelectedId(hit.id);
    setDetailOpen(true);
    setQuery("");
  };

  // Where you are: the way from the term to what is chosen (or to what is in focus), each step a way back to it.
  const here = pathTo(tree, selectedId ?? focusId ?? tree.id);
  const crumb = (id: string) => {
    if (id === tree.id) return focusOn(null);
    const node = findNode(tree, id);
    if (node && node.kind !== "section" && node.kind !== "subjects") return focusOn(id);
    select(id);
  };

  return (
    <div className={styles.explorer}>
      <div className={styles.toolbar}>
        {map.terms.length > 1 ? (
          <Select label={t("structure.term")} value={term.id} onChange={(e) => chooseTerm(e.target.value)} options={map.terms.map((x) => ({ value: x.id, label: x.label }))} />
        ) : null}
        <StatusWord tone={term.status === "active" ? "ok" : "neutral"}>{t(term.status === "active" ? "setup.map.active" : "setup.map.draft")}</StatusWord>
        <Link href={termHref} className={styles.settings}>
          <Settings aria-hidden />
          {t("structure.settings")}
        </Link>
        {narrow ? null : <Segments label={t("structure.view")} value={view} onChange={setViewChoice} options={[{ key: "flow", label: t("structure.view.flow") }, { key: "list", label: t("structure.view.list") }]} />}
      </div>

      <div className={styles.searchArea}>
        <label className={styles.search}>
          <Search aria-hidden />
          <span className="sr-only">{t("structure.search")}</span>
          <input type="search" value={query} placeholder={t("structure.search")} maxLength={100} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {query.trim() !== "" ? (
          <ul className={styles.results} aria-label={t("structure.results")}>
            {hits.length === 0 ? <li className={styles.muted}>{t("structure.search.none")}</li> : null}
            {hits.map((h, i) => {
              const Icon = ICONS[h.kind];
              return (
                <li key={`${h.id}-${i}`}>
                  <button type="button" className={styles.result} onClick={() => pick(h)}>
                    <Icon aria-hidden />
                    <span>
                      <span className={styles.resultName}>
                        {h.label} <span className={styles.nodeKind}>{kindWord(h.kind, words)}</span>
                      </span>
                      {h.place ? <span className={styles.nodeMeta}>{h.place}</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      <nav aria-label={t("structure.crumbs")}>
        <ol className={styles.crumbs}>
          {here.map((n, i) => (
            <Fragment key={n.id}>
              <li>
                {i === here.length - 1 ? (
                  <span aria-current="location">{nodeTitle(n)}</span>
                ) : (
                  <button type="button" className={styles.crumb} onClick={() => crumb(n.id)}>
                    {nodeTitle(n)}
                  </button>
                )}
              </li>
            </Fragment>
          ))}
          {focusId ? (
            <li className={styles.crumbBack}>
              <Button variant="quiet" onClick={() => focusOn(null)}>
                {t("structure.back")}
              </Button>
            </li>
          ) : null}
        </ol>
      </nav>

      {tree.children.length === 0 ? (
        <p className={styles.muted}>{t("setup.map.noLevels", words)}</p>
      ) : view === "flow" ? (
        <StructureFlowView root={root} open={open} selectedId={selectedId} words={words} onSelect={select} onToggle={toggle} />
      ) : (
        <StructureListView root={root} open={open} selectedId={selectedId} words={words} onSelect={select} onToggle={toggle} />
      )}

      {detailOpen && selected ? (
        <StructureDetail
          key={selected.id}
          node={selected}
          words={words}
          reach={reach}
          termHref={termHref}
          canFocus={selected.kind === "wing" || selected.kind === "course" || selected.kind === "level"}
          onFocus={() => focusOn(selected.id)}
          onClose={() => setDetailOpen(false)}
        />
      ) : null}
    </div>
  );
}
