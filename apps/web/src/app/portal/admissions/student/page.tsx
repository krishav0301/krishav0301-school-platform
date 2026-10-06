"use client";

import { AdmissionsLayout } from "@/admissions/AdmissionsLayout";
import { StudentScreen } from "@/admissions/StudentScreen";

/** One student's record, read only, from the Students page (admin FUT F-09). */
export default function StudentRecordPage() {
  return (
    <AdmissionsLayout>
      <StudentScreen />
    </AdmissionsLayout>
  );
}
