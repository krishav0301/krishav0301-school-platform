"use client";

import { useSession } from "@/session/SessionProvider";

import { MySheetsScreen } from "./MarkSheetScreen";
import { OwnResultsScreen } from "./OwnResultsScreen";
import { ReviewBoardScreen } from "./ReviewScreen";
import { RechecksScreen } from "./StaffScreens";

/** Results (Phase 7): a student sees their own; a teacher their mark sheets; the Co-ordinator the review board; the Admin the changes. */
export function ResultsHome() {
  const { me } = useSession();
  const roles = me?.roles.map((r) => r.role) ?? [];
  if (roles.includes("student")) return <OwnResultsScreen />;
  if (roles.includes("coordinator") || roles.includes("super_admin")) return <ReviewBoardScreen />;
  if (roles.includes("teacher")) return <MySheetsScreen />;
  return <RechecksScreen />;
}
