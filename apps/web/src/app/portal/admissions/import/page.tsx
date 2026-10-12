"use client";

import { AdmissionsLayout } from "@/admissions/AdmissionsLayout";
import { ImportScreen } from "@/admissions/ImportScreen";
import { RoleGate } from "@/shell/RoleGate";

/** The Co-ordinator's import of a class list from Excel (D-156): the class, then the template and the upload. */
export default function AdmissionsImportPage() {
  return (
    <AdmissionsLayout>
      <RoleGate roles={["coordinator", "super_admin"]}>
        <ImportScreen />
      </RoleGate>
    </AdmissionsLayout>
  );
}
