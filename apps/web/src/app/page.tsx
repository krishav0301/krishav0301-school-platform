"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

import { ConfigGate } from "@/config/ConfigGate";
import { useConfig } from "@/config/ConfigProvider";
import { useSession } from "@/session/SessionProvider";
import { PublicShell } from "@/shell/PublicShell";
import { HomeFrameView } from "@/site/HomeView";
import { homeStage, type ScrollSite } from "@/site/scroll/choose-home";
import { HomeWaiting } from "@/site/scroll/HomeWaiting";
import { useSite } from "@/site/SiteFrame";
import { useUrgentNotices } from "@/site/useUrgentNotices";

// The one-page layout is loaded only for a school that chose it, so every other school's front page stays as light as before (D-167).
const loadScrollHome = () => import("@/site/scroll/ScrollHome").then((m) => m.ScrollHome);
const ScrollHome = dynamic(loadScrollHome, { ssr: false, loading: () => <HomeWaiting /> });

/**
 * The school's front page: the one-page layout when its pack chose it, otherwise admissions first from the words in its pack.
 * Open to everyone. While the school is not known, or a one-page school's words load, an empty page is drawn, never the
 * classic frame, so the old page does not flash before the new one (PM, 2026-10-13).
 */
export default function HomePage() {
  const { status: configStatus, config } = useConfig();
  const { status } = useSession();
  const { view, retry } = useSite();
  const urgent = useUrgentNotices();
  const layout = config?.school.publicLayout;
  const stage = homeStage(configStatus, layout, view);

  // Fetch the one-page layout's code while its words are still arriving.
  useEffect(() => {
    if (layout === "scroll") void loadScrollHome();
  }, [layout]);

  if (stage === "waiting") return <HomeWaiting />;
  if (stage === "message" || !config) {
    return (
      <PublicShell>
        <ConfigGate>{null}</ConfigGate>
      </PublicShell>
    );
  }
  // A school that chose the one-page layout (D-167) gets it whole, with its own top bar; every other school keeps the usual shell.
  if (stage === "scroll" && view.status === "ready") return <ScrollHome schoolName={config.school.name} site={view.site as ScrollSite} signedIn={status === "signedIn"} />;
  return (
    <PublicShell>
      <HomeFrameView schoolName={config.school.name} sections={config.sections} view={view} urgent={urgent} onRetry={retry} />
    </PublicShell>
  );
}
