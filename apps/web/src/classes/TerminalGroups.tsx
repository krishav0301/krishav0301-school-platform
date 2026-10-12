"use client";

import { ClipboardList } from "lucide-react";
import { useState, type ReactNode } from "react";

import { t } from "@/i18n/messages";
import { GROUP_TONES, GroupCard, GroupList } from "@/read/GroupCard";
import { OpenLink, ReadTable } from "@/read/ReadView";

import type { ClassHub } from "./model";

type Hub = Pick<ClassHub, "class" | "viewer" | "mySubjects" | "terminals">;

/**
 * The class page's Results tab, grouped by exam (the PM, 2026-10-12): one card for each exam, in the design of the Classes
 * page, the first open to begin with. `body` is what a card holds. Pure apart from what `body` does.
 */
export function TerminalCards({ terminals, stat, body }: { terminals: Hub["terminals"]; stat?: { label: string; value: (terminalId: string) => number }; body: (terminal: Hub["terminals"][number]) => ReactNode }) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const isOpen = (id: string, index: number) => toggled[id] ?? index === 0;
  return (
    <GroupList>
      {terminals.map((x, i) => (
        <GroupCard
          key={x.id}
          title={x.name}
          icon={<ClipboardList />}
          tone={GROUP_TONES[i % GROUP_TONES.length]!}
          stats={stat ? [{ label: stat.label, value: stat.value(x.id) }] : []}
          open={isOpen(x.id, i)}
          onToggle={() => setToggled((now) => ({ ...now, [x.id]: !isOpen(x.id, i) }))}
          toggleLabel={t(isOpen(x.id, i) ? "classes.exam.hide" : "classes.exam.show", { name: x.name })}
        >
          {body(x)}
        </GroupCard>
      ))}
    </GroupList>
  );
}

/** A subject teacher's own marks: a card for each exam, the subjects they take in this class inside it. */
export function MyMarksByExam({ hub }: { hub: Hub }) {
  return (
    <TerminalCards
      terminals={hub.terminals}
      stat={{ label: t("classes.col.subject"), value: () => hub.mySubjects.length }}
      body={(x) => (
        <ReadTable
          caption={t("classes.yourMarksFor", { exam: x.name })}
          rows={hub.mySubjects}
          rowKey={(s) => s.offeringId}
          columns={[
            { key: "subject", label: t("classes.col.subject"), primary: true, cell: (s) => s.name },
            {
              key: "open",
              label: t("classes.col.open"),
              align: "end",
              plain: true,
              cell: (s) => <OpenLink href={`/portal/results/sheet?class=${hub.class.id}&subject=${s.offeringId}&terminal=${x.id}`} label={t("classes.marksNamed", { subject: s.name, exam: x.name })} text={t("classes.open")} />,
            },
          ]}
        />
      )}
    />
  );
}
