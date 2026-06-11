"use client";

import { trackBookletEvent } from "@/lib/booklet/track";
import type { BookletEventChannel } from "@/lib/booklet/events";

/**
 * Externer Link, der beim Klick fire-and-forget ein `link_click`-Event feuert
 * (Schritt 10a) — z. B. die Outro-Website-Pille (`channel='website'`). Das
 * Navigieren bleibt das native `<a>`-Verhalten; das Tracking blockiert es nicht.
 */
export function TrackedLink({
  token,
  channel,
  href,
  className,
  ariaLabel,
  children,
}: {
  token: string;
  channel: BookletEventChannel;
  href: string;
  className?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={className}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      onClick={() => trackBookletEvent(token, "link_click", channel)}
    >
      {children}
    </a>
  );
}
