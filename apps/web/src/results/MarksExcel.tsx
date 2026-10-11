"use client";

import { FileDown, FileUp } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";

import { t } from "@/i18n/messages";
import { readTable } from "@/sheets/table";
import { marksTemplateCsv, parseMarksSheet, type MarkProblem, type MarksImport } from "@/sheets/marks-import";
import { Button, Notice } from "@/ui";

import type { MarkSheet } from "./model";
import styles from "./results.module.css";

/** A file name that is safe on any machine: letters, digits, dashes. */
const fileName = (sheet: MarkSheet): string => `${sheet.subjectName}-${sheet.terminal.name}`.replace(/[^A-Za-z0-9ऀ-ॿ]+/g, "-").replace(/^-+|-+$/g, "") || "marks";

/** What a person is told about a sheet they uploaded. Pure, so the words are tested. */
export function importWords(result: Extract<MarksImport, { ok: true }>): { tone: "ok" | "bad"; lines: string[] } {
  const lines: string[] = [];
  lines.push(t(result.filled === 0 ? "results.excel.nothingFilled" : "results.excel.filled", { count: result.filled }));
  if (result.notFound.length > 0) lines.push(t("results.excel.notFound", { count: result.notFound.length, ids: result.notFound.slice(0, 5).join(", ") + (result.notFound.length > 5 ? "…" : "") }));
  const reason = (p: MarkProblem) => t(p.reason === "over_max" ? "results.excel.overMax" : "results.excel.notAMark");
  for (const p of result.problems.slice(0, 8)) lines.push(t("results.excel.problem", { name: p.name, sid: p.sid, part: p.part, text: p.text, reason: reason(p) }));
  if (result.problems.length > 8) lines.push(t("results.excel.moreProblems", { count: result.problems.length - 8 }));
  if (result.missingRows > 0) lines.push(t("results.excel.missingRows", { count: result.missingRows }));
  return { tone: result.problems.length > 0 || result.notFound.length > 0 || result.filled === 0 ? "bad" : "ok", lines };
}

const FAILURE = {
  no_id_column: "results.excel.noId",
  no_mark_columns: "results.excel.noMarks",
  no_rows: "results.excel.noRows",
} as const;

/**
 * Download a subject's sheet, fill it in Excel, upload it (the PM, 2026-10-11): the marks go into the boxes, and nothing is
 * saved until the teacher saves, so every mark is looked at once more.
 */
export function MarksExcel({ sheet, onFill }: { sheet: MarkSheet; onFill: (draft: Record<string, string>) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [said, setSaid] = useState<{ tone: "ok" | "bad"; lines: string[] } | null>(null);

  function download() {
    const url = URL.createObjectURL(new Blob([marksTemplateCsv(sheet)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName(sheet)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function chosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // the same file can be chosen again after a fix
    if (!file) return;
    const read = await readTable(file);
    if (!read.ok) return setSaid({ tone: "bad", lines: [t(read.reason === "unsupported" ? "results.excel.unsupported" : "results.excel.unreadable")] });
    const parsed = parseMarksSheet(read.rows, sheet);
    if (!parsed.ok) return setSaid({ tone: "bad", lines: [t(FAILURE[parsed.reason])] });
    if (Object.keys(parsed.draft).length > 0) onFill(parsed.draft);
    setSaid(importWords(parsed));
  }

  return (
    <div className={styles.excel}>
      <p className={styles.meta}>{t("results.excel.hint")}</p>
      <div className={styles.actions}>
        <Button variant="secondary" className={styles.wrapLabel} onClick={download}>
          <FileDown aria-hidden width={18} height={18} />
          {t("results.excel.download")}
        </Button>
        <Button variant="secondary" className={styles.wrapLabel} onClick={() => input.current?.click()}>
          <FileUp aria-hidden width={18} height={18} />
          {t("results.excel.upload")}
        </Button>
        <input ref={input} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => void chosen(e)} aria-label={t("results.excel.upload")} />
      </div>
      {said ? (
        <Notice tone={said.tone}>
          {said.lines.map((line, i) => (
            <span key={i} className={styles.excelLine}>
              {line}
            </span>
          ))}
        </Notice>
      ) : null}
    </div>
  );
}
