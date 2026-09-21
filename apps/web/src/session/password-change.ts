import type { MessageKey } from "@/i18n/messages";

/**
 * Choosing a new password after signing in with a temporary one (D-059). Pure functions, kept apart from the session
 * provider so they can be tested without a browser.
 */

export type PasswordProblemKey = "too_short" | "too_long" | "common" | "contains_email" | "contains_school_name";

const PROBLEM_MESSAGE: Record<PasswordProblemKey, MessageKey> = {
  too_short: "reset.weak.too_short",
  too_long: "reset.weak.too_long",
  common: "reset.weak.common",
  contains_email: "reset.weak.contains_email",
  contains_school_name: "reset.weak.contains_school_name",
};

export type ChangeFailure = { reason: "weak"; problems: readonly PasswordProblemKey[] } | { reason: "same" | "invalid_challenge" | "network" | "unexpected" };

/** What the API's answer to a refused change means. */
export function passwordChangeFailure(status: number, error: unknown): ChangeFailure {
  const body = typeof error === "object" && error !== null ? (error as { error?: unknown; problems?: unknown }) : {};
  if (status === 401 && body.error === "invalid_challenge") return { reason: "invalid_challenge" };
  if (status === 422 && body.error === "same_password") return { reason: "same" };
  if (status === 422 && body.error === "weak_password" && Array.isArray(body.problems)) {
    return { reason: "weak", problems: body.problems.filter((p): p is PasswordProblemKey => typeof p === "string" && p in PROBLEM_MESSAGE) };
  }
  return { reason: "unexpected" };
}

/** What to tell someone whose new password was not accepted, and whether their sign-in has expired so they must start again. */
export function changeFailureMessages(failure: ChangeFailure): { keys: MessageKey[]; restart: boolean } {
  switch (failure.reason) {
    case "weak":
      return { keys: failure.problems.map((problem) => PROBLEM_MESSAGE[problem]), restart: false };
    case "same":
      return { keys: ["signIn.samePassword"], restart: false };
    case "invalid_challenge":
      return { keys: ["twoFactor.expired"], restart: true };
    case "network":
      return { keys: ["signIn.network"], restart: false };
    default:
      return { keys: ["signIn.unexpected"], restart: false };
  }
}
