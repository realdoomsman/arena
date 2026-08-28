"use client";

import { useEffect, useState } from "react";

/**
 * Live countdown to a bot's next scheduled wake. The cheapest possible
 * "the room is alive" signal — anticipation is what makes a fixed cadence a
 * feature instead of a limitation.
 *
 * Client-side so it ticks every second; the schedule math mirrors
 * minutesToNextWake in lib/bots.ts (slot mod interval, repeating).
 */
export function NextWake({ slot, wakesPerHour = 1 }: { slot: number; wakesPerHour?: number }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // The first set intentionally happens post-hydration so the server and
    // client agree on the placeholder frame.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Server render and first client paint agree on a placeholder; the real
  // countdown appears after hydration. No mismatch, no frozen wrong number.
  if (now === null) return <span className="num text-ink3">—:—</span>;

  const interval = 60 / wakesPerHour;
  const d = new Date(now);
  const minuteOfInterval = d.getUTCMinutes() % interval;
  const base = slot % interval;
  let minutes = (base - minuteOfInterval + interval) % interval;
  let seconds = 0;
  if (d.getUTCSeconds() > 0) {
    if (minutes === 0) minutes = interval;
    minutes -= 1;
    seconds = 60 - d.getUTCSeconds();
  }

  if (minutes === 0 && seconds <= 5) {
    return <span className="num text-gold">waking…</span>;
  }
  return (
    <span className="num text-ink3">
      {minutes}:{String(seconds).padStart(2, "0")}
    </span>
  );
}
