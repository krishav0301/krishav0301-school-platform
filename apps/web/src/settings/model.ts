import type { MessageKey } from "@/i18n/messages";
import { changeFailureMessages, passwordChangeFailure } from "@/session/password-change";

/** What to say when changing your own password is refused (Settings, D-091). Pure, so it is tested without a browser. */
export function ownPasswordFailure(status: number, error: unknown): MessageKey[] {
  const body = typeof error === "object" && error !== null ? (error as { error?: unknown }) : {};
  if (status === 422 && body.error === "wrong_password") return ["settings.password.wrong"];
  if (status === 429) return ["settings.password.throttled"];
  if (status === 401) return ["settings.password.signedOut"];
  const failure = passwordChangeFailure(status, error);
  if (failure.reason === "weak" || failure.reason === "same") return changeFailureMessages(failure).keys;
  return ["settings.failed"];
}

/** A profile form's own checks, before anything is sent: a name of 2 to 120 letters, a phone of 5 to 30 or none. */
export function profileProblems(values: { fullName: string; phone: string }): MessageKey[] {
  const problems: MessageKey[] = [];
  const name = values.fullName.trim();
  if (name.length < 2 || name.length > 120) problems.push("settings.profile.nameInvalid");
  const phone = values.phone.trim();
  if (phone !== "" && (phone.length < 5 || phone.length > 30)) problems.push("settings.profile.phoneInvalid");
  return problems;
}
