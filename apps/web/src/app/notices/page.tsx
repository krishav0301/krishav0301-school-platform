"use client";

import { ConfigGate } from "@/config/ConfigGate";
import { NoticeBoard } from "@/content/NoticeBoard";
import { PublicShell } from "@/shell/PublicShell";

/** What is on the school's website today: open to everyone, no sign-in (D-039). */
export default function NoticesPage() {
  return (
    <PublicShell>
      <ConfigGate>
        <NoticeBoard />
      </ConfigGate>
    </PublicShell>
  );
}
