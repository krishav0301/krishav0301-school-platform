"use client";

import { AttendanceLayout } from "@/attendance/AttendanceTabs";
import { OwnMonthScreen } from "@/attendance/OwnMonthScreen";
import { RoleGate } from "@/shell/RoleGate";

/** A teacher's own attendance, month by month, read-only (D-070). */
export default function OwnAttendancePage() {
  return (
    <AttendanceLayout>
      <RoleGate roles={["teacher"]}>
        <OwnMonthScreen />
      </RoleGate>
    </AttendanceLayout>
  );
}
