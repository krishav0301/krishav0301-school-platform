"use client";

import { AttendanceLayout } from "@/attendance/AttendanceTabs";
import { OwnMonthScreen } from "@/attendance/OwnMonthScreen";

/** A teacher's own attendance, month by month, read-only (D-070). */
export default function OwnAttendancePage() {
  return (
    <AttendanceLayout>
      <OwnMonthScreen />
    </AttendanceLayout>
  );
}
