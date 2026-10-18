"use client";

import dynamic from "next/dynamic";
import { useEffect, useSyncExternalStore } from "react";

import { ConfigGate } from "@/config/ConfigGate";
import { useConfig } from "@/config/ConfigProvider";
import { useSession } from "@/session/SessionProvider";
import { PublicShell } from "@/shell/PublicShell";
import { frontStage } from "@/site/front-stage";
import type { ImmersiveSite } from "@/site/immersive/ImmersiveHome";
import { readLayoutHint, type ScrollSite } from "@/site/scroll/choose-home";
import { HomeWaiting } from "@/site/scroll/HomeWaiting";
import { SignInHome } from "@/site/SignInHome";
import { SiteFrameView, useSite } from "@/site/SiteFrame";

// The one-page layout is loaded only for a school that chose it, so every other school's front page stays as light as before (D-167).
const loadScrollHome = () => import("@/site/scroll/ScrollHome").then((m) => m.ScrollHome);
const ScrollHome = dynamic(loadScrollHome, { ssr: false, loading: () => <HomeWaiting /> });
// The immersive layout (D-178) is loaded the same way, only for a school that chose it.
const loadImmersiveHome = () => import("@/site/immersive/ImmersiveHome").then((m) => m.ImmersiveHome);
const ImmersiveHome = dynamic(loadImmersiveHome, { ssr: false, loading: () => <HomeWaiting /> });

const noChange = () => () => {};
// Nothing is known on the server or while hydrating, so the page matches what was served; the stamp is read straight after.
const useLayoutHint = () => useSyncExternalStore(noChange, () => readLayoutHint(document), () => undefined);

/**
 * The school's front page: the one-page layout when its pack chose one (scroll, or immersive), otherwise one Sign in button in the middle of an
 * empty page (PM, 2026-10-18, D-177: the old public pages are gone). Open to everyone. While the school is not known, or a
 * one-page school's words load, an empty page is drawn, so nothing else flashes before the real page (PM, 2026-10-13).
 */
export default function HomePage() {
  const { status: configStatus, config } = useConfig();
  const { status } = useSession();
  const { view, retry } = useSite();
  const layout = config?.school.publicLayout;
  const hint = useLayoutHint();
  const stage = frontStage(configStatus, layout, view, hint);

  // Fetch the one-page layout's code while its words are still arriving.
  useEffect(() => {
    if (layout === "scroll") void loadScrollHome();
    if (layout === "immersive") void loadImmersiveHome();
  }, [layout]);

  if (stage === "waiting") return <HomeWaiting />;
  if (stage === "signin") return <SignInHome schoolName={config?.school.name} signedIn={status === "signedIn"} />;
  if (stage === "message" || !config) {
    return (
      <PublicShell>
        <ConfigGate>{null}</ConfigGate>
      </PublicShell>
    );
  }
  if (stage === "retry") {
    return (
      <PublicShell>
        <SiteFrameView title={config.school.name} view={view} onRetry={retry}>
          {() => null}
        </SiteFrameView>
      </PublicShell>
    );
  }
  // A school that chose a one-page layout (D-167, D-178) gets it whole, with its own top bar. Its words are here at these stages.
  if (view.status !== "ready") return <HomeWaiting />;
  if (stage === "immersive") return <ImmersiveHome schoolName={config.school.name} site={view.site as ImmersiveSite} signedIn={status === "signedIn"} />;
  return <ScrollHome schoolName={config.school.name} site={view.site as ScrollSite} signedIn={status === "signedIn"} />;
}
