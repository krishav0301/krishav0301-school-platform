"use client";

import { AttendanceLayout } from "@/attendance/AttendanceTabs";
import { AttendanceScreen } from "@/attendance/AttendanceScreen";

/** Student attendance (D-069): the Class Teacher's register, and the classes for those who oversee them. */
export default function AttendancePage() {
  return (
    <AttendanceLayout>
      <AttendanceScreen />
    </AttendanceLayout>
  );
}
