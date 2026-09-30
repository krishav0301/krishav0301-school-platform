"use client";

import { ClassworkLayout } from "@/classwork/ClassworkTabs";
import { NotesScreen } from "@/classwork/NotesScreen";

/** Notes and question papers (D-072): shared by teachers, read watermarked by students. */
export default function NotesPage() {
  return (
    <ClassworkLayout>
      <NotesScreen />
    </ClassworkLayout>
  );
}
