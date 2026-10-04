"use client";

import { AttendanceLayout } from "@/attendance/AttendanceTabs";
import { OwnMonthScreen } from "@/attendance/OwnMonthScreen";
import { StudentAttendanceScreen } from "@/attendance/StudentAttendanceScreen";
import { useSession } from "@/session/SessionProvider";
import { RoleGate } from "@/shell/RoleGate";

/** A teacher's own attendance month by month (D-070), or a student's own year (D-107); both read only. */
export default function OwnAttendancePage() {
  const { me } = useSession();
  const teacher = me?.roles.some((r) => r.role === "teacher") ?? false;
  return (
    <AttendanceLayout>
      <RoleGate roles={["teacher", "student"]}>{teacher ? <OwnMonthScreen /> : <StudentAttendanceScreen />}</RoleGate>
    </AttendanceLayout>
  );
}
