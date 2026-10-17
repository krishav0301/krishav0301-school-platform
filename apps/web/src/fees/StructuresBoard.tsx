"use client";

import { ArrowRight, CalendarDays, Info, Layers, ReceiptText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { t } from "@/i18n/messages";
import { FilterSelect, SearchBox } from "@/people/ListParts";
import accessStyles from "@/people/people-access.module.css";
import { buttonClass } from "@/ui";
import termStyles from "@/terms/terms.module.css";

import { STATUS_LABEL, type FeeStructureList } from "./model";
import { nprShort } from "./ReadFees";
import { StructureStatus, periodText } from "./StructuresScreen";

type Structure = FeeStructureList["structures"][number];

/** Each live card's tint, in turn, as the terms page does. */
const TONES = ["primary", "ok", "accent", "warn"] as const;

const wingName = (x: Structure, sections: readonly { key: string; name: string }[]) => sections.find((s) => s.key === x.sectionKey)?.name ?? x.sectionKey;

/** The page's note on what a fee structure is, in the terms page's banner. Pure. */
export function StructuresBanner() {
  return (
    <p className={termStyles.banner}>
      <Info aria-hidden />
      <span>{t("fees.structures.banner")}</span>
    </p>
  );
}

/** Currently Live: one card per live structure, as the terms page shows active terms. Pure. */
export function LiveStructures({ structures, sections }: { structures: readonly Structure[]; sections: readonly { key: string; name: string }[] }) {
  const live = structures.filter((x) => x.status === "live" && !x.ended);
  return (
    <section className={termStyles.board} aria-labelledby="live-structures">
      <div>
        <h2 id="live-structures" className={termStyles.boardTitle}>
          <span className={termStyles.liveDot} aria-hidden />
          {t("fees.structures.live.title", { n: live.length })}
        </h2>
        <p className={termStyles.meta}>{t("fees.structures.live.intro")}</p>
      </div>
      {live.length === 0 ? <p className={termStyles.meta}>{t("fees.structures.live.none")}</p> : null}
      <ul className={termStyles.cards}>
        {live.map((x, i) => (
          <li key={x.id} className={termStyles.card} data-tone={TONES[i % TONES.length]}>
            <div className={termStyles.cardTop}>
              <span className={accessStyles.tile} data-tone={TONES[i % TONES.length]} aria-hidden>
                <ReceiptText />
              </span>
              <StructureStatus status={x.status} ended={x.ended} />
            </div>
            <div>
              <h3 className={termStyles.cardTitle}>{x.name}</h3>
              <p className={termStyles.meta}>{wingName(x, sections)}</p>
            </div>
            <p className={termStyles.line}>
              <CalendarDays aria-hidden />
              <span>{periodText(x)}</span>
            </p>
            <p className={termStyles.line}>
              <Layers aria-hidden />
              <span>{x.levelsLinked === 0 ? t("fees.structures.live.notLinked") : t("fees.structures.live.linked", { n: x.levelsLinked })}</span>
            </p>
            <dl className={termStyles.counts}>
              <div>
                <dt>{t("fees.col.total")}</dt>
                <dd>{nprShort(x.totalPaisa)}</dd>
              </div>
            </dl>
            <Link href={`/portal/fees/structure?id=${x.id}`} className={`${buttonClass({ variant: "secondary" })} ${termStyles.manage}`} aria-label={t("fees.structures.open", { name: x.name })}>
              {t("fees.structures.openStructure")}
              <ArrowRight aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

type OtherStatus = "" | "draft" | "waiting" | "ended";

/** Other Structures: drafts and those waiting for the Principal, searched and filtered by state. Pure but for its filters. */
export function OtherStructures({ structures, sections }: { structures: readonly Structure[]; sections: readonly { key: string; name: string }[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<OtherStatus>("");
  const others = structures.filter((x) => x.status !== "live" || x.ended);
  const needle = q.trim().toLowerCase();
  const rows = others.filter((x) => (!status || (status === "ended" ? x.ended : x.status === status)) && (!needle || x.name.toLowerCase().includes(needle)));
  return (
    <section className={termStyles.board} aria-labelledby="other-structures">
      <div className={termStyles.boardHead}>
        <div>
          <h2 id="other-structures" className={termStyles.boardTitle}>
            {t("fees.structures.other.title")}
          </h2>
          <p className={termStyles.meta}>{t("fees.structures.other.intro")}</p>
        </div>
        {others.length > 0 ? (
          <div className={termStyles.tools}>
            <SearchBox label="fees.structures.search" value={q} onChange={setQ} />
            <FilterSelect
              label="content.filterState"
              value={status}
              onChange={(v) => setStatus(v as OtherStatus)}
              options={[
                { value: "", label: t("content.filterAll") },
                { value: "draft", label: t(STATUS_LABEL.draft) },
                { value: "waiting", label: t(STATUS_LABEL.waiting) },
                { value: "ended", label: t("fees.status.ended") },
              ]}
            />
          </div>
        ) : null}
      </div>
      {others.length === 0 ? <p className={termStyles.meta}>{t("fees.structures.other.none")}</p> : rows.length === 0 ? <p className={termStyles.meta}>{t("fees.structures.other.noneFound")}</p> : null}
      {rows.length > 0 ? (
        <table className={accessStyles.table}>
          <thead>
            <tr>
              <th scope="col">{t("fees.structures.name")}</th>
              <th scope="col">{t("fees.col.period")}</th>
              <th scope="col">{t("fees.col.total")}</th>
              <th scope="col">{t("attendance.class.status")}</th>
              <th scope="col">
                <span className="sr-only">{t("fees.col.lines")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id}>
                <td className={accessStyles.nameCell}>
                  <span className={accessStyles.personName}>{x.name}</span>
                  <span className={termStyles.meta}>{wingName(x, sections)}</span>
                </td>
                <td data-label={t("fees.col.period")}>{periodText(x)}</td>
                <td data-label={t("fees.col.total")}>{nprShort(x.totalPaisa)}</td>
                <td data-label={t("attendance.class.status")}>
                  <StructureStatus status={x.status} ended={x.ended} />
                </td>
                <td className={accessStyles.actionsCell}>
                  <Link href={`/portal/fees/structure?id=${x.id}`} className={buttonClass({ variant: "quiet" })} aria-label={t("fees.structures.open", { name: x.name })}>
                    {t("fees.structures.openStructure")}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
