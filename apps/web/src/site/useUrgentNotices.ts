"use client";

import { useEffect, useState } from "react";

import { createApiClient } from "@/api/client";
import { loadPublic } from "@/content/client";

/** The titles of up to three urgent notices live today, for the strip on Home. A failure shows nothing: the strip is a bonus. */
export function useUrgentNotices(): { id: string; title: string }[] {
  const [api] = useState(() => createApiClient());
  const [urgent, setUrgent] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    let alive = true;
    void loadPublic(api).then((result) => {
      if (alive && result.ok) setUrgent(result.items.filter((item) => item.urgent).slice(0, 3).map(({ id, title }) => ({ id, title })));
    });
    return () => {
      alive = false;
    };
  }, [api]);

  return urgent;
}
