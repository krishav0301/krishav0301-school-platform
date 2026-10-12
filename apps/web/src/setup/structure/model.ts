import type { SetupMap } from "../model";

/**
 * The Academic Structure as a tree (the PM, 2026-10-12, D-157): a term, its wings, their courses, their levels (the
 * classes), and under a level its subjects and its sections. Built from the setup map the page already loads; nothing here
 * is stored, so opening and closing a branch never touches the data. Pure.
 */
export type Term = SetupMap["terms"][number];
type Wing = Term["wings"][number];
type Course = Wing["departments"][number];
type Level = Course["levels"][number];
type Section = Level["sections"][number];

export type NodeKind = "term" | "wing" | "course" | "level" | "subjects" | "section";

export interface Counts {
  courses: number;
  classes: number;
  sections: number;
  students: number;
}

export type Payload =
  | { kind: "term"; term: Term }
  | { kind: "wing"; wing: Wing }
  | { kind: "course"; course: Course }
  | { kind: "level"; level: Level }
  | { kind: "subjects"; level: Level }
  | { kind: "section"; section: Section; level: Level };

export interface StructNode {
  id: string;
  kind: NodeKind;
  name: string;
  parentId: string | null;
  counts: Counts;
  children: StructNode[];
  payload: Payload;
}

const none: Counts = { courses: 0, classes: 0, sections: 0, students: 0 };
const add = (a: Counts, b: Counts): Counts => ({ courses: a.courses + b.courses, classes: a.classes + b.classes, sections: a.sections + b.sections, students: a.students + b.students });

export const termId = (id: string) => `term:${id}`;

/** The whole tree of one term. Every count is added up from the sections below it. */
export function buildTree(term: Term, unnamedSection = "Section"): StructNode {
  const root = termId(term.id);
  const sectionNode = (s: Section, level: Level, parentId: string): StructNode => ({
    id: `section:${s.id}`,
    kind: "section",
    name: s.label || unnamedSection,
    parentId,
    counts: { courses: 0, classes: 0, sections: 1, students: s.students },
    children: [],
    payload: { kind: "section", section: s, level },
  });
  const levelNode = (level: Level, parentId: string): StructNode => {
    const id = `level:${level.id}`;
    const sections = level.sections.map((s) => sectionNode(s, level, id));
    const subjects: StructNode[] =
      level.subjects.length === 0 ? [] : [{ id: `subjects:${level.id}`, kind: "subjects", name: "", parentId: id, counts: none, children: [], payload: { kind: "subjects", level } }];
    return {
      id,
      kind: "level",
      name: level.name,
      parentId,
      counts: sections.reduce((sum, s) => add(sum, s.counts), { ...none, classes: 1 }),
      children: [...subjects, ...sections],
      payload: { kind: "level", level },
    };
  };
  const courseNode = (course: Course, parentId: string): StructNode => {
    const id = `course:${course.id}`;
    const levels = course.levels.map((l) => levelNode(l, id));
    return { id, kind: "course", name: course.name, parentId, counts: levels.reduce((sum, l) => add(sum, l.counts), { ...none, courses: 1 }), children: levels, payload: { kind: "course", course } };
  };
  const wingNode = (wing: Wing): StructNode => {
    const id = `wing:${wing.key}`;
    const courses = wing.departments.map((d) => courseNode(d, id));
    return { id, kind: "wing", name: wing.name, parentId: root, counts: courses.reduce((sum, c) => add(sum, c.counts), { ...none }), children: courses, payload: { kind: "wing", wing } };
  };
  const wings = term.wings.map(wingNode);
  return { id: root, kind: "term", name: term.label, parentId: null, counts: wings.reduce((sum, w) => add(sum, w.counts), { ...none }), children: wings, payload: { kind: "term", term } };
}

/** Every node, parents before their children. */
export function allNodes(root: StructNode): StructNode[] {
  return [root, ...root.children.flatMap(allNodes)];
}

export const findNode = (root: StructNode, id: string): StructNode | null => allNodes(root).find((n) => n.id === id) ?? null;

/** The nodes from the root down to `id`, itself last; empty when there is no such node. */
export function pathTo(root: StructNode, id: string): StructNode[] {
  const byId = new Map(allNodes(root).map((n) => [n.id, n]));
  const path: StructNode[] = [];
  for (let node = byId.get(id); node; node = node.parentId ? byId.get(node.parentId) : undefined) path.unshift(node);
  return path;
}

/**
 * What is open once `id` is chosen: the way down to it, and itself. Everything else is shut, so a branch opened elsewhere
 * closes when another is opened, and the picture stays small however large the school is.
 */
export const openingPath = (root: StructNode, id: string): Set<string> => new Set(pathTo(root, id).map((n) => n.id));

/** Closing a node closes what is below it too. */
export function closing(root: StructNode, open: ReadonlySet<string>, id: string): Set<string> {
  const below = new Set(allNodes(findNode(root, id) ?? root).map((n) => n.id));
  return new Set([...open].filter((x) => !below.has(x)));
}

export interface Hit {
  id: string;
  /** What matched: a name, or "Physics" in a level's subjects. */
  label: string;
  kind: NodeKind;
  /** Where it sits, "Wing / Course / Level", for the list of results. */
  place: string;
}

/** The nodes, and the subjects of each level, whose names hold the words typed; at most `limit`. */
export function searchTree(root: StructNode, query: string, limit = 12): Hit[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const hits: Hit[] = [];
  for (const node of allNodes(root)) {
    const place = pathTo(root, node.parentId ?? node.id)
      .filter((n) => n.kind !== "term")
      .map((n) => n.name)
      .join(" / ");
    if (node.kind !== "subjects" && node.name.toLowerCase().includes(q)) hits.push({ id: node.id, label: node.name, kind: node.kind, place });
    if (node.kind === "subjects" && node.payload.kind === "subjects") {
      for (const s of node.payload.level.subjects) if (s.name.toLowerCase().includes(q)) hits.push({ id: node.id, label: s.name, kind: "subjects", place });
    }
    if (hits.length >= limit) break;
  }
  return hits.slice(0, limit);
}

// --- Layout ---------------------------------------------------------------------------------------------------------

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  boxes: Map<string, Box>;
  edges: { from: string; to: string }[];
  width: number;
  height: number;
}

export const NODE_W = 232;
export const NODE_H = 92;
export const GAP_X = 24;
export const GAP_Y = 56;
export const MARGIN = 24;

/**
 * Where each node goes, top down: a node sits centred over its open children, and a branch is as wide as the nodes under
 * it, so nothing overlaps and an open branch makes room only for itself. A closed node shows no children. Pure.
 */
export function layoutTree(root: StructNode, open: ReadonlySet<string>): Layout {
  const boxes = new Map<string, Box>();
  const edges: Layout["edges"] = [];
  const kids = (n: StructNode) => (open.has(n.id) ? n.children : []);
  const widths = new Map<string, number>();
  const widthOf = (n: StructNode): number => {
    const own = kids(n).reduce((sum, c, i) => sum + widthOf(c) + (i > 0 ? GAP_X : 0), 0);
    const w = Math.max(NODE_W, own);
    widths.set(n.id, w);
    return w;
  };
  widthOf(root);
  let height = 0;
  const place = (n: StructNode, left: number, depth: number) => {
    const w = widths.get(n.id)!;
    const y = MARGIN + depth * (NODE_H + GAP_Y);
    boxes.set(n.id, { x: left + (w - NODE_W) / 2, y, w: NODE_W, h: NODE_H });
    height = Math.max(height, y + NODE_H + MARGIN);
    let cursor = left + (w - kids(n).reduce((sum, c, i) => sum + widths.get(c.id)! + (i > 0 ? GAP_X : 0), 0)) / 2;
    for (const c of kids(n)) {
      edges.push({ from: n.id, to: c.id });
      place(c, cursor, depth + 1);
      cursor += widths.get(c.id)! + GAP_X;
    }
  };
  place(root, MARGIN, 0);
  return { boxes, edges, width: widths.get(root.id)! + MARGIN * 2, height };
}
