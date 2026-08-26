"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps the room current.
 *
 * Refreshes server data on an interval rather than holding a socket open: the
 * arena's fastest event is one bot waking per five minutes, so a socket would
 * be idle almost always and a poll is both simpler and cheaper.
 *
 * Pauses while the tab is hidden — a background tab quietly re-rendering
 * eleven bots' state forever is a battery leak nobody asked for.
 */
export function LiveTick({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  const [since, setSince] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => setSince((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      setSince(0);
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[0.62rem] text-ink3">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-good" />
      </span>
      live · {since}s
    </span>
  );
}
