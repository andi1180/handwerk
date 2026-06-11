"use client";

import { useEffect, useRef } from "react";
import { trackBookletEvent } from "@/lib/booklet/track";

/**
 * Feuert beim Mount EINMALIG das `viewed`-Event (Schritt 10a). Rendert nichts.
 *
 * Gilt für ALLE Öffner — Kunde UND Empfänger eines geteilten Links (Reichweite
 * zählt), unabhängig von `?c=1`. Der `useRef`-Guard verhindert den Doppel-Fire
 * durch das React-StrictMode-Doppel-Mount in dev.
 */
export function ViewTracker({ token }: { token: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackBookletEvent(token, "viewed");
  }, [token]);
  return null;
}
