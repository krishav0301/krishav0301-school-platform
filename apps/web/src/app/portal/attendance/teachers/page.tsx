"use client";

import { AttendanceLayout } from "@/attendance/AttendanceTabs";
import { TeacherDayScreen } from "@/attendance/TeacherDayScreen";

/** Teacher attendance (D-070): the Co-ordinator's daily list; the Admin reads it. */
export default function TeacherAttendancePage() {
  return (
    <AttendanceLayout>
      <TeacherDayScreen />
    </AttendanceLayout>
  );
}
