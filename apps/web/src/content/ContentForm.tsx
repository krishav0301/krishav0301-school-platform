"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Badge, Button, Card, Checkbox, Field, Notice, Select, Skeleton, TextArea, buttonClass } from "@/ui";

import { useAddressQuery } from "./address";
import { BsDateField } from "./BsDateField";
import { loadContent, loadItem, submitForm } from "./client";
import { ContentPreview } from "./ContentPreview";
import {
  KINDS,
  KIND_LABEL,
  emptyForm,
  firstInvalid,
  formFromItem,
  parseEditTarget,
  validateForm,
  type FieldName,
  type FlashKind,
  type FormErrors,
  type FormValues,
  type Kind,
} from "./model";
import styles from "./content.module.css";

type Loaded = { status: "loading" } | { status: "ready"; values: FormValues; live: boolean } | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "failed" };

/** Make a new item, or change the one named in the address (`?id=`). */
export function ContentForm() {
  const { api } = useSession();
  const router = useRouter();
  const search = useAddressQuery();
  const target = useMemo(() => (search === null ? null : parseEditTarget(search)), [search]);
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });

  useEffect(() => {
    if (!target) return;
    let active = true;
    (async () => {
      if (target.mode === "invalid") return setLoaded({ status: "not_found" });
      if (target.mode === "edit") {
        const result = await loadItem(api, target.id);
        if (!active) return;
        setLoaded(result.ok ? { status: "ready", values: formFromItem(result.item), live: result.item.status === "live" } : { status: result.reason });
        return;
      }
      // A new item starts on today's Nepali date; one light request gets it.
      const result = await loadContent(api, { limit: 1 });
      if (!active) return;
      setLoaded(result.ok ? { status: "ready", values: emptyForm(result.todayBs, target.kind), live: false } : { status: result.reason });
    })();
    return () => {
      active = false;
    };
  }, [api, target]);

  if (loaded.status === "loading") {
    return (
      <div role="status" aria-busy="true">
        <span className="sr-only">{t("contentForm.loading")}</span>
        <div className={styles.fields} aria-hidden>
          <Skeleton width="40%" height="1.75rem" />
          <Skeleton height="2.75rem" />
          <Skeleton height="8rem" />
        </div>
      </div>
    );
  }

  if (loaded.status === "not_found") {
    return (
      <Card className={styles.message}>
        <h1 className={styles.title}>{t("contentForm.notFoundTitle")}</h1>
        <p className={styles.muted}>{t("contentForm.notFoundBody")}</p>
        <Link href="/portal/content" className={buttonClass({ variant: "secondary" })}>
          {t("contentForm.backToList")}
        </Link>
      </Card>
    );
  }

  if (loaded.status === "forbidden" || loaded.status === "failed") {
    return <Notice tone="bad">{t(loaded.status === "forbidden" ? "content.forbidden" : "content.loadFailed")}</Notice>;
  }

  const id = target?.mode === "edit" ? target.id : null;
  return (
    <ContentEditor
      key={id ?? "new"}
      id={id}
      initial={loaded.values}
      live={loaded.live}
      onSaved={(outcome) => router.push(`/portal/content?done=${outcome}`)}
      onGone={() => setLoaded({ status: "not_found" })}
    />
  );
}

/** The form itself, once the item (or today's date) is loaded. Exported so it can be drawn in tests without a network. */
export function ContentEditor({ id, initial, live, onSaved, onGone }: { id: string | null; initial: FormValues; live: boolean; onSaved: (outcome: FlashKind) => void; onGone: () => void }) {
  const { api } = useSession();
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<MessageKey | null>(null);
  // Which button is working: saving a draft (or the changes), or saving and publishing.
  const [pending, setPending] = useState<"draft" | "publish" | null>(null);
  const [focus, setFocus] = useState<{ field: FieldName; tick: number } | null>(null);

  const title = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const contact = useRef<HTMLInputElement>(null);
  const publishOn = useRef<HTMLInputElement>(null);
  const hideAfter = useRef<HTMLInputElement>(null);
  const holidayFrom = useRef<HTMLInputElement>(null);
  const holidayTo = useRef<HTMLInputElement>(null);
  const fieldRefs = { title, body, contact, holidayFromBs: holidayFrom, holidayToBs: holidayTo, publishOnBs: publishOn, hideAfterBs: hideAfter };
  const isHoliday = values.kind === "holiday";

  // Move the cursor to the first field with a problem, once the messages are on screen.
  useEffect(() => {
    if (focus) fieldRefs[focus.field].current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the refs are stable; only a new request to focus should run this
  }, [focus]);

  const set = <K extends keyof FormValues>(name: K, value: FormValues[K]) => setValues((current) => ({ ...current, [name]: value }));

  /**
   * Saves, and with `publish` puts it on the website too. Pressing Enter in a box saves (a draft, or the
   * changes to a live item): only a deliberate click on Publish goes public. If the save works but the
   * publishing does not, the item is already saved, so the person is taken to the list and told so; staying
   * here would let a second click make a second copy.
   */
  async function run(publish: boolean) {
    if (pending) return;
    setFailure(null);

    const problems = validateForm(values);
    if (Object.keys(problems).length > 0) return showProblems(problems);

    setPending(publish ? "publish" : "draft");
    const result = await submitForm(api, id, values, publish);

    if ("done" in result) return onSaved(result.done);
    setPending(null);
    if ("fields" in result) return showProblems(result.fields);
    if ("gone" in result) return onGone();
    setErrors({});
    setFailure(result.problem === "forbidden" ? "content.forbidden" : result.problem === "rejected" ? "contentForm.error.rejected" : "contentForm.error.saveFailed");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(false);
  }

  function showProblems(problems: FormErrors) {
    setErrors(problems);
    setFailure("contentForm.summary");
    const first = firstInvalid(problems);
    if (first) setFocus((current) => ({ field: first, tick: (current?.tick ?? 0) + 1 }));
  }

  return (
    <>
      <h1 className={styles.title}>{t(id === null ? "contentForm.newTitle" : "contentForm.editTitle")}</h1>
      {live ? <Notice>{t("contentForm.liveNotice")}</Notice> : null}

      <div className={styles.formGrid}>
        <Card className={styles.formCard}>
          <form onSubmit={submit} noValidate className={styles.fields}>
            {failure ? <Notice tone="bad">{t(failure)}</Notice> : null}

            {id === null ? (
              <Select
                label={t("contentForm.type")}
                value={values.kind}
                onChange={(event) => set("kind", event.target.value as Kind)}
                options={KINDS.map((k) => ({ value: k, label: t(KIND_LABEL[k]) }))}
              />
            ) : (
              <div className={styles.locked}>
                <span className={styles.lockedLabel}>{t("contentForm.type")}</span>
                <Badge>{t(KIND_LABEL[values.kind])}</Badge>
                <span className={styles.muted}>{t("contentForm.typeLocked")}</span>
              </div>
            )}

            <Field
              ref={title}
              label={t("contentForm.titleField")}
              value={values.title}
              autoComplete="off"
              onChange={(event) => set("title", event.target.value)}
              error={errors.title ? t(errors.title) : undefined}
            />
            <TextArea
              ref={body}
              label={t("contentForm.body")}
              hint={t("contentForm.bodyHint")}
              value={values.body}
              rows={8}
              onChange={(event) => set("body", event.target.value)}
              error={errors.body ? t(errors.body) : undefined}
            />
            {values.kind === "vacancy" ? (
              <Field
                ref={contact}
                label={t("contentForm.contact")}
                hint={t("contentForm.contactHint")}
                value={values.contact}
                autoComplete="off"
                onChange={(event) => set("contact", event.target.value)}
                error={errors.contact ? t(errors.contact) : undefined}
              />
            ) : null}
            <Checkbox label={t("contentForm.urgent")} hint={t("contentForm.urgentHint")} checked={values.urgent} onChange={(event) => set("urgent", event.target.checked)} />
            {isHoliday ? (
              // A holiday names its own day first, so nobody mistakes "Show from" for it (D-094).
              <>
                <BsDateField
                  ref={holidayFrom}
                  legend={t("contentForm.holidayFrom")}
                  hint={t("contentForm.holidayFromHint")}
                  value={values.holidayFromBs}
                  onChange={(text) => set("holidayFromBs", text)}
                  error={errors.holidayFromBs ? t(errors.holidayFromBs) : undefined}
                />
                <BsDateField
                  ref={holidayTo}
                  legend={t("contentForm.holidayTo")}
                  hint={t("contentForm.holidayToHint")}
                  value={values.holidayToBs}
                  onChange={(text) => set("holidayToBs", text)}
                  error={errors.holidayToBs ? t(errors.holidayToBs) : undefined}
                />
              </>
            ) : null}
            <BsDateField
              ref={publishOn}
              legend={t("contentForm.publishOn")}
              hint={t(isHoliday ? "contentForm.holidayShowHint" : "contentForm.dateHint")}
              value={values.publishOnBs}
              onChange={(text) => set("publishOnBs", text)}
              error={errors.publishOnBs ? t(errors.publishOnBs) : undefined}
            />
            {isHoliday ? null : (
              <BsDateField
                ref={hideAfter}
                legend={t("contentForm.hideAfter")}
                hint={t("contentForm.hideAfterHint")}
                value={values.hideAfterBs}
                onChange={(text) => set("hideAfterBs", text)}
                error={errors.hideAfterBs ? t(errors.hideAfterBs) : undefined}
              />
            )}

            <div className={styles.actions}>
              <Link href="/portal/content" className={buttonClass({ variant: "quiet" })}>
                {t("contentForm.cancel")}
              </Link>
              {live ? (
                // An item that is already on the website has one action: save the changes (they go live at once).
                <Button type="submit" loading={pending === "draft"} loadingLabel={t("contentForm.saving")}>
                  {pending === "draft" ? t("contentForm.saving") : t("contentForm.saveChanges")}
                </Button>
              ) : (
                <>
                  {/* Save draft comes first and is the only submit button, so Enter in a box saves and never publishes. */}
                  <Button type="submit" variant="secondary" loading={pending === "draft"} disabled={pending === "publish"} loadingLabel={t("contentForm.saving")}>
                    {pending === "draft" ? t("contentForm.saving") : t("contentForm.save")}
                  </Button>
                  <Button loading={pending === "publish"} disabled={pending === "draft"} loadingLabel={t("contentForm.publishing")} onClick={() => void run(true)}>
                    {pending === "publish" ? t("contentForm.publishing") : t("contentForm.publish")}
                  </Button>
                </>
              )}
            </div>
          </form>
        </Card>

        <ContentPreview values={values} />
      </div>
    </>
  );
}
