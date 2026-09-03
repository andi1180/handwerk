"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { t, type Locale } from "@/lib/i18n";

/**
 * Video einer Medien-Seite der öffentlichen Web-Story /b/[token].
 *
 * AUTOPLAY-VERHALTEN (nur hier — das Portal bleibt beim Tap-zum-Abspielen):
 * Ein IntersectionObserver beobachtet das Element im Scroll-Container
 * (`.booklet-scroll`, Scroll-Snap). Sobald es zu mindestens VISIBLE_RATIO im
 * sichtbaren Bereich liegt, läuft es los (`loop`), verlässt es ihn, pausiert es.
 * Damit spielt immer nur das gerade sichtbare Video; alle anderen stehen still.
 *
 * MUTED IST PFLICHT, nicht Geschmackssache: die Autoplay-Policy aller aktuellen
 * Browser (iOS Safari, Chrome Mobile/Desktop) erlaubt automatisches Abspielen
 * ausschließlich stumm — mit Ton lehnt `play()` ab. Der Ausgangszustand ist
 * deshalb IMMER stumme Endlos-Wiedergabe; Ton gibt es nur auf ausdrücklichen
 * Tap des Nutzers (eigener Button, nur wenn das Video überhaupt eine Tonspur
 * hat). Wird ein `play()` trotzdem abgelehnt (z. B. beim Zurückscrollen auf ein
 * zuvor entstummtes Video), schalten wir stumm und versuchen es genau einmal
 * erneut — lieber stumm laufen als schwarz stehen.
 *
 * Die Bedienelemente (Play/Pause + Ton) bleiben zusätzlich sichtbar, damit der
 * Nutzer jederzeit eingreifen kann. Der native `controls`-Balken entfällt dafür
 * (er würde über der Story-Optik liegen und beim Autoplay ständig aufblenden).
 */

/** Ab diesem Sichtbarkeits-Anteil gilt das Video als „im Bild". */
const VISIBLE_RATIO = 0.5;

/**
 * Tonspur erkennen. Es gibt dafür keinen einheitlichen Standard-Weg, deshalb
 * die drei herstellerspezifischen Signale in dieser Reihenfolge. Alle liefern
 * erst nach dem Laden/Decodieren verlässlich etwas (`webkitAudioDecodedByteCount`
 * zählt erst während der Wiedergabe hoch) — der Aufrufer prüft daher mehrfach.
 * Im Zweifel `false`: kein Ton-Button ist besser als einer, der nichts tut.
 */
function hasAudioTrack(video: HTMLVideoElement): boolean {
  const el = video as HTMLVideoElement & {
    mozHasAudio?: boolean;
    audioTracks?: { length: number };
    webkitAudioDecodedByteCount?: number;
  };
  if (el.mozHasAudio) return true;
  if ((el.audioTracks?.length ?? 0) > 0) return true;
  if ((el.webkitAudioDecodedByteCount ?? 0) > 0) return true;
  return false;
}

export function BookletVideo({
  src,
  locale,
  className,
}: {
  src: string;
  locale: Locale;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /** Vom Nutzer bewusst pausiert ⇒ der Observer startet nicht erneut. */
  const userPausedRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [hasAudio, setHasAudio] = useState(false);

  const attemptPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const started = video.play();
    if (!started) return;
    started.catch(() => {
      // Abgelehnt (Autoplay-Policy) — stumm schalten und genau einmal erneut.
      if (video.muted) return;
      video.muted = true;
      setMuted(true);
      void video.play().catch(() => {});
    });
  }, []);

  /* `muted` zusätzlich als DOM-Property setzen: React rendert das Attribut beim
     Server-Rendering nicht zuverlässig mit, und ohne gesetztes muted lehnt die
     Autoplay-Policy das erste play() ab. */
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = true;
  }, []);

  /* Sichtbarkeit → abspielen/pausieren. Root ist der Story-Scroller. */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const root = video.closest(".booklet-scroll");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO) {
            if (!userPausedRef.current) attemptPlay();
          } else {
            video.pause();
            // Beim Verlassen des Bildes den manuellen Pause-Wunsch zurücksetzen:
            // ein erneutes Hinscrollen ist ein frischer Besuch der Seite.
            userPausedRef.current = false;
          }
        }
      },
      { root, threshold: [0, VISIBLE_RATIO, 1] },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [attemptPlay]);

  /* Tonspur erkennen (mehrfach, s. hasAudioTrack). */
  const checkAudio = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (hasAudioTrack(video)) setHasAudio(true);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      userPausedRef.current = false;
      attemptPlay();
    } else {
      userPausedRef.current = true;
      video.pause();
    }
  }, [attemptPlay]);

  const toggleMuted = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const next = !video.muted;
    video.muted = next;
    setMuted(next);
    // Ton einschalten ist eine Nutzer-Geste ⇒ hier darf das Video auch anlaufen.
    if (!next && video.paused) {
      userPausedRef.current = false;
      attemptPlay();
    }
  }, [attemptPlay]);

  return (
    <>
      <video
        ref={videoRef}
        className={className}
        src={src}
        loop
        muted
        playsInline
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedData={checkAudio}
        onPlaying={checkAudio}
        onTimeUpdate={hasAudio ? undefined : checkAudio}
      />
      <div className="booklet-video-controls">
        <button
          type="button"
          className="booklet-video-btn"
          onClick={togglePlay}
          aria-label={t(locale, playing ? "booklet.videoPause" : "booklet.videoPlay")}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        {hasAudio ? (
          <button
            type="button"
            className="booklet-video-btn"
            onClick={toggleMuted}
            aria-label={t(locale, muted ? "booklet.videoUnmute" : "booklet.videoMute")}
          >
            {muted ? <MutedIcon /> : <SoundIcon />}
          </button>
        ) : null}
      </div>
    </>
  );
}

/* --- Icons (rein dekorativ, currentColor) --- */

function PlayIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13a.6.6 0 0 0 .92.5l10-6.5a.6.6 0 0 0 0-1l-10-6.5a.6.6 0 0 0-.92.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="7" y="5" width="3.6" height="14" rx="1" />
      <rect x="13.4" y="5" width="3.6" height="14" rx="1" />
    </svg>
  );
}

function SoundIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 5 6.5 9H3v6h3.5L11 19z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 5 6.5 9H3v6h3.5L11 19z" />
      <path d="M16 9.5l5 5" />
      <path d="M21 9.5l-5 5" />
    </svg>
  );
}
