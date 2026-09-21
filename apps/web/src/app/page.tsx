"use client";

import { ConfigGate } from "@/config/ConfigGate";
import { useConfig } from "@/config/ConfigProvider";
import { PublicShell } from "@/shell/PublicShell";
import { HomeFrameView } from "@/site/HomeView";
import { useSite } from "@/site/SiteFrame";
import { useUrgentNotices } from "@/site/useUrgentNotices";

function Home() {
  const { config } = useConfig();
  const { view, retry } = useSite();
  const urgent = useUrgentNotices();
  if (!config) return null;
  return <HomeFrameView schoolName={config.school.name} sections={config.sections} view={view} urgent={urgent} onRetry={retry} />;
}

/** The school's front page: admissions first, from the words in its pack. Open to everyone. */
export default function HomePage() {
  return (
    <PublicShell>
      <ConfigGate>
        <Home />
      </ConfigGate>
    </PublicShell>
  );
}
