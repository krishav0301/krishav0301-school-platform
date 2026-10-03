"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";

import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Bell } from "lucide-react";

import { Button, Card, Checkbox, Field, Notice, Skeleton, buttonClass } from "@/ui";

import { useAddressQuery } from "./address";
import { BsDateField } from "./BsDateField";
import { loadContent, loadItem, submitForApproval, submitForm } from "./client";
import { ContentPreview } from "./ContentPreview";
import { KindTile } from "./KindIcon";
import { TextEditor } from "./TextEditor";
import {
  KINDS,
  KIND_LABEL,
  KIND_TONE,
  emptyForm,
  firstInvalid,
  formFromItem,
  parseEditTarget,
  validateForm,
  type FieldName,
  type FlashKind,
  type FormErrors,
  type FormValues,
} from "./model";
import contentStyles from "./content.module.css";
import styles from "./website.module.css";

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
      // A new item starts at today's Nepali date and the time now; one light request gets both.
      const result = await loadContent(api, { pageSize: 1 });
      if (!active) return;
      setLoaded(result.ok ? { status: "ready", values: emptyForm(result.todayBs, target.kind, result.nowTime), live: false } : { status: result.reason });
    })();
    return () => {
      active = false;
    };
  }, [api, target]);

  if (loaded.status === "loading") {
    return (
      <div role="status" aria-busy="true">
        <span className="sr-only">{t("contentForm.loading")}</span>
        <div className={contentStyles.fields} aria-hidden>
          <Skeleton width="40%" height="1.75rem" />
          <Skeleton height="2.75rem" />
          <Skeleton height="8rem" />
        </div>
      </div>
    );
  }

  if (loaded.status === "not_found") {
    return (
      <Card className={contentStyles.message}>
        <h1 className={contentStyles.title}>{t("contentForm.notFoundTitle")}</h1>
        <p className={contentStyles.muted}>{t("contentForm.notFoundBody")}</p>
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
    <>
      <div className={contentStyles.header}>
        <div>
          <h1 className={contentStyles.title}>{t(id === null ? "contentForm.newTitle" : "contentForm.editTitle")}</h1>
          <p className={contentStyles.muted}>{t(id === null ? "contentForm.newSubtitle" : "contentForm.editSubtitle")}</p>
        </div>
      </div>
      <ContentEditor
      key={id ?? "new"}
      id={id}
      initial={loaded.values}
      live={loaded.live}
      onSaved={(outcome) => router.push(`/portal/content?done=${outcome}`)}
      onGone={() => setLoaded({ status: "not_found" })}
      />
    </>
  );
}

/**
 * The form itself, once the item (or today's date) is loaded: on the edit page, and in the pop-up the list opens
 * (D-098). Laid out after the PM's reference: what it is and what it says on the left; urgency, when it shows and
 * the buttons in the middle; the live preview on the right. Exported so it can be drawn in tests without a network.
 * `onCancel` closes the pop-up; without it, Cancel goes back to the list.
 */
export function ContentEditor({
  id,
  initial,
  live,
  onSaved,
  onGone,
  onCancel,
}: {
  id: string | null;
  initial: FormValues;
  live: boolean;
  onSaved: (outcome: FlashKind) => void;
  onGone: () => void;
  onCancel?: () => void;
}) {
  const { api, me } = useSession();
  // Only the Principal (and Support) publish; a Co-ordinator sends a draft for approval instead (D-061, Co-ordinator FUT F-08).
  const canPublish = (me?.roles ?? []).some((r) => r.role === "admin" || r.role === "super_admin");
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<MessageKey | null>(null);
  // Which button is working: saving a draft (or the changes), or saving and publishing.
  const [pending, setPending] = useState<"draft" | "publish" | null>(null);
  const [focus, setFocus] = useState<{ field: FieldName; tick: number } | null>(null);
  const typeLegend = useId();

  const title = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const contact = useRef<HTMLInputElement>(null);
  const publishOn = useRef<HTMLInputElement>(null);
  const publishTime = useRef<HTMLInputElement>(null);
  const hideAfter = useRef<HTMLInputElement>(null);
  const holidayFrom = useRef<HTMLInputElement>(null);
  const holidayTo = useRef<HTMLInputElement>(null);
  const fieldRefs = { title, body, contact, holidayFromBs: holidayFrom, holidayToBs: holidayTo, publishOnBs: publishOn, publishTime, hideAfterBs: hideAfter };
  const isHoliday = values.kind === "holiday";

  // Move the cursor to the first field with a problem, once the messages are on screen.
  useEffect(() => {
    if (focus) fieldRefs[focus.field].current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the refs are stable; only a new request to focus should run this
  }, [focus]);

  const set = <K extends keyof FormValues>(name: K, value: FormValues[K]) => setValues((current) => ({ ...current, [name]: value }));

  /**
   * Saves, and with `publish` puts it on the website too (or schedules it, when its date and time are still to
   * come). Pressing Enter in a box saves (a draft, or the changes to a live item): only a deliberate click on
   * Publish goes public. If the save works but the publishing does not, the item is already saved, so the person
   * is taken to the list and told so; staying here would let a second click make a second copy. If nothing is
   * saved, the form keeps everything typed.
   */
  async function run(publish: boolean) {
    if (pending) return;
    setFailure(null);

    const problems = validateForm(values);
    if (Object.keys(problems).length > 0) return showProblems(problems);

    setPending(publish ? "publish" : "draft");
    const result = publish && !canPublish ? await submitForApproval(api, id, values) : await submitForm(api, id, values, publish);

    if ("done" in result) return onSaved(result.done);
    setPending(null);
    if ("fields" in result) return showProblems(result.fields);
    if ("gone" in result) return onGone();
    setErrors({});
    setFailure(
      result.problem === "forbidden" ? "content.forbidden" : result.problem === "rejected" ? "contentForm.error.rejected" : publish ? "contentForm.error.publishFailed" : "contentForm.error.saveFailed",
    );
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

  const cancel = onCancel ? (
    <Button variant="secondary" onClick={onCancel}>
      {t("contentForm.cancel")}
    </Button>
  ) : (
    <Link href="/portal/content" className={buttonClass({ variant: "secondary" })}>
      {t("contentForm.cancel")}
    </Link>
  );

  return (
    <form onSubmit={submit} noValidate className={styles.editorGrid}>
      <div className={styles.editorMain}>
        {failure ? <Notice tone="bad">{t(failure)}</Notice> : null}
        {live ? <Notice>{t("contentForm.liveNotice")}</Notice> : null}

        <fieldset className={styles.typeCards} aria-describedby={id === null ? undefined : typeLegend}>
          <legend className={styles.typeLegend}>{t("contentForm.type")}</legend>
          <div className={styles.typeGrid}>
            {KINDS.map((k) => (
              <label key={k} className={styles.typeCard} data-tone={KIND_TONE[k]} data-checked={values.kind === k ? true : undefined}>
                <input
                  type="radio"
                  name="kind"
                  value={k}
                  className={styles.typeRadio}
                  checked={values.kind === k}
                  // The type is fixed once the item is saved; the others are shown, but cannot be chosen.
                  disabled={id !== null && values.kind !== k}
                  onChange={() => set("kind", k)}
                />
                <KindTile kind={k} size="small" />
                <span className={styles.typeName}>{t(KIND_LABEL[k])}</span>
              </label>
            ))}
          </div>
          {id !== null ? (
            <p id={typeLegend} className={styles.muted}>
              {t("contentForm.typeLocked")}
            </p>
          ) : null}
        </fieldset>

        <Field
          ref={title}
          label={`${t("contentForm.titleField")} *`}
          value={values.title}
          placeholder={t("contentForm.titlePlaceholder")}
          autoComplete="off"
          aria-required
          onChange={(event) => set("title", event.target.value)}
          error={errors.title ? t(errors.title) : undefined}
        />
        <TextEditor
          ref={body}
          label={t("contentForm.body")}
          hint={t("contentForm.bodyHint")}
          placeholder={t("contentForm.bodyPlaceholder")}
          value={values.body}
          onChange={(text) => set("body", text)}
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
      </div>

      <div className={styles.editorSide}>
        <div className={styles.urgentBox}>
          <Checkbox
            label={t("contentForm.urgent")}
            hint={t("contentForm.urgentHint")}
            checked={values.urgent}
            onChange={(event) => set("urgent", event.target.checked)}
          />
          <Bell aria-hidden className={styles.urgentIcon} />
        </div>
        {isHoliday ? (
          // A holiday names its own day first, so nobody mistakes the publish date for it (D-094).
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
          legend={`${t("contentForm.publishOn")} *`}
          hint={t(isHoliday ? "contentForm.holidayShowHint" : "contentForm.dateHint")}
          value={values.publishOnBs}
          onChange={(text) => set("publishOnBs", text)}
          error={errors.publishOnBs ? t(errors.publishOnBs) : undefined}
        />
        <Field
          ref={publishTime}
          type="time"
          label={t("contentForm.time")}
          hint={t("contentForm.timeHint")}
          value={values.publishTime}
          onChange={(event) => set("publishTime", event.target.value)}
          error={errors.publishTime ? t(errors.publishTime) : undefined}
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

        <div className={styles.editorActions}>
          {cancel}
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
              <Button loading={pending === "publish"} disabled={pending === "draft"} loadingLabel={t(canPublish ? "contentForm.publishing" : "contentForm.sending")} onClick={() => void run(true)}>
                {pending === "publish" ? t(canPublish ? "contentForm.publishing" : "contentForm.sending") : t(canPublish ? "contentForm.publish" : "contentForm.sendForApproval")}
              </Button>
            </>
          )}
        </div>
      </div>

      <ContentPreview values={values} />
    </form>
  );
}
