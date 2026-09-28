"use client";

import { AttendanceLayout } from "@/attendance/AttendanceTabs";
import { ClassAttendanceScreen } from "@/attendance/ClassAttendanceScreen";

/** One class's attendance (`?id=`). A static export has no dynamic routes, so the id is in the address query. */
export default function ClassAttendancePage() {
  return (
    <AttendanceLayout>
      <ClassAttendanceScreen />
    </AttendanceLayout>
  );
}
