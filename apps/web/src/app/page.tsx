"use client";

import dynamic from "next/dynamic";

import { ConfigGate } from "@/config/ConfigGate";
import { useConfig } from "@/config/ConfigProvider";
import { useSession } from "@/session/SessionProvider";
import { PublicShell } from "@/shell/PublicShell";
import { HomeFrameView } from "@/site/HomeView";
import { chooseHome, type ScrollSite } from "@/site/scroll/choose-home";
import { useSite } from "@/site/SiteFrame";
import { useUrgentNotices } from "@/site/useUrgentNotices";

// The one-page layout is loaded only for a school that chose it, so every other school's front page stays as light as before (D-167).
const ScrollHome = dynamic(() => import("@/site/scroll/ScrollHome").then((m) => m.ScrollHome), { ssr: false });

function Home() {
  const { config } = useConfig();
  const { status } = useSession();
  const { view, retry } = useSite();
  const urgent = useUrgentNotices();
  if (!config) return null;
  // A school that chose the one-page layout (D-167) gets it whole, with its own top bar; every other school keeps the usual shell.
  if (view.status === "ready" && chooseHome(view) === "scroll") return <ScrollHome schoolName={config.school.name} site={view.site as ScrollSite} signedIn={status === "signedIn"} />;
  return (
    <PublicShell>
      <HomeFrameView schoolName={config.school.name} sections={config.sections} view={view} urgent={urgent} onRetry={retry} />
    </PublicShell>
  );
}

/** The school's front page: the one-page layout when its pack chose it, otherwise admissions first from the words in its pack. Open to everyone. */
export default function HomePage() {
  const { status } = useConfig();
  // Until the school's configuration is here (or when it cannot be), say so inside the usual frame.
  if (status !== "ready") {
    return (
      <PublicShell>
        <ConfigGate>{null}</ConfigGate>
      </PublicShell>
    );
  }
  return <Home />;
}
