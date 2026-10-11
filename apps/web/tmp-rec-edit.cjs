const fs = require("fs");
const edit = (p, fn) => {
  let s = fs.readFileSync(p, "utf8");
  const rep = (a, b) => {
    if (!s.includes(a)) throw new Error(p + " missing: " + a.slice(0, 80));
    s = s.replace(a, () => b);
  };
  fn(rep);
  fs.writeFileSync(p, s);
};

edit("src/results/client.ts", (rep) => {
  rep(
    "export const loadCard =",
    '/** A student\'s published results, for the staff who may open their record (the PM, 2026-10-11). */\nexport const loadStudentResults = (api: ApiClient, studentId: string): Promise<Loaded<OwnResults>> => load(() => api.GET("/api/results/students/{studentId}", { params: { path: { studentId } } }));\nexport const loadCard =',
  );
});

edit("src/i18n/messages.ts", (rep) => {
  rep(
    '  "admissions.notGiven": "Not given",',
    `  "admissions.notGiven": "Not given",
  "nav.students": "Students",
  "admissions.record.results": "Results",
  "admissions.record.resultsNone": "No result has been published for this student yet.",
  "admissions.record.resultsCaption": "Published results",
  "admissions.record.resultExam": "Exam",
  "admissions.record.resultPercent": "Percentage",
  "admissions.record.resultResult": "Result",
  "admissions.record.resultCard": "Marks card",`,
  );
});

edit("src/admissions/StudentScreen.tsx", (rep) => {
  rep(
    'import { EmptyLine, OpenLink, Panel, ReadFailure, ReadHeader, ReadOnlyNote, StatusWord, TableSkeleton, readStyles } from "@/read/ReadView";',
    'import { EmptyLine, OpenLink, Panel, ReadFailure, ReadHeader, ReadOnlyNote, ReadTable, StatusWord, TableSkeleton, readStyles } from "@/read/ReadView";\nimport { loadStudentResults } from "@/results/client";\nimport { percentText, type OwnResults } from "@/results/model";\nimport { resultName } from "@/results/OwnResultsScreen";',
  );
  rep(
    '  const reader = !roles.some((r) => r === "coordinator" || r === "super_admin");',
    '  const reader = !roles.some((r) => r === "coordinator" || r === "super_admin");\n  // Staff who read results (the Principal, the Co-ordinator, Support) see the student\'s published results on the record (the PM, 2026-10-11).\n  const resultsLink = roles.some((r) => r === "admin" || r === "coordinator" || r === "super_admin");',
  );
  rep(
    '      {feesLink && id ? <RecordFees',
    '      {resultsLink && id ? <RecordResults studentId={id} /> : null}\n      {feesLink && id ? <RecordFees',
  );
  rep(
    "/** Pure: the fees section of a record, or the line that says there is no account yet. */",
    `/** The student's published results on their record: each exam, then the final, with the marks card to open. */
function RecordResults({ studentId }: { studentId: string }) {
  const { api } = useSession();
  const load = useCallback(() => loadStudentResults(api, studentId), [api, studentId]);
  const { view, reload } = useLoad<OwnResults>(load);
  if (view.status === "loading") return <TableSkeleton rows={3} />;
  if (view.status !== "ready") return <ReadFailure status={view.status} onRetry={() => void reload()} />;
  return <RecordResultsView results={view.data} />;
}

/** Pure: the results section of a record, or the line that says none is published yet. */
export function RecordResultsView({ results }: { results: OwnResults }) {
  return (
    <section className={readStyles.page} aria-labelledby="record-results">
      <h2 id="record-results" className={readStyles.panelTitle}>
        {t("admissions.record.results")}
      </h2>
      {results.results.length === 0 ? (
        <EmptyLine>{t("admissions.record.resultsNone")}</EmptyLine>
      ) : (
        <ReadTable
          caption={t("admissions.record.resultsCaption")}
          rows={results.results}
          rowKey={(r) => r.publicationId}
          columns={[
            { key: "exam", label: t("admissions.record.resultExam"), primary: true, cell: (r) => resultName(r) },
            { key: "percent", label: t("admissions.record.resultPercent"), cell: (r) => percentText(r.card.body.percentHundredths) },
            {
              key: "result",
              label: t("admissions.record.resultResult"),
              cell: (r) => (r.card.body.kind === "final" ? (r.card.body.grade ?? t(r.card.body.passed ? "results.card.pass" : "results.card.fail")) : (r.card.body.grade ?? "—")),
            },
            { key: "card", label: t("admissions.record.resultCard"), align: "end", plain: true, cell: (r) => <OpenLink href={\`/portal/results/card?id=\${r.card.id}\`} label={t("results.own.openCard")} text={t("admissions.record.resultCard")} /> },
          ]}
        />
      )}
    </section>
  );
}

/** Pure: the fees section of a record, or the line that says there is no account yet. */`,
  );
});

// The Principal's menu calls the Admissions page "Students": for the Principal it is only a place to find students.
edit("src/shell/nav.ts", (rep) => {
  rep("  /** The label a Co-ordinator sees instead, when it is the only one of these roles they hold (D-131). */\n  coordinatorLabelKey?: MessageKey;", "  /** The label a Co-ordinator sees instead, when it is the only one of these roles they hold (D-131). */\n  coordinatorLabelKey?: MessageKey;\n  /** The label the Principal sees instead, when Admin is the only one of these roles they hold (the PM, 2026-10-11). */\n  adminLabelKey?: MessageKey;");
  rep('{ id: "admissions", labelKey: "nav.admissions",', '{ id: "admissions", labelKey: "nav.admissions", adminLabelKey: "nav.students",');
  rep(
    "    .map((item) => (onlyCoordinator && item.coordinatorLabelKey ? { ...item, labelKey: item.coordinatorLabelKey } : item));",
    "    .map((item) => (onlyCoordinator && item.coordinatorLabelKey ? { ...item, labelKey: item.coordinatorLabelKey } : onlyAdmin && item.adminLabelKey ? { ...item, labelKey: item.adminLabelKey } : item));",
  );
  rep("  const onlyCoordinator =", "  // Only the Principal: not also a Co-ordinator or Support, who keep the full name.\n  const onlyAdmin = roles.some((r) => r.role === \"admin\") && !roles.some((r) => r.role === \"coordinator\" || r.role === \"super_admin\" || r.role === \"accountant\");\n  const onlyCoordinator =");
});
