"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Capture } from "./capture";
import { MediaList, type MediaWithUrl } from "./media-list";
import type { MediaCategory } from "@/lib/orders/queries";

/**
 * Client-Wrapper um Capture + MediaList.
 *
 * Hält einen `extraFrames`-State (Map<mediaId, string[]>) für Frame-URLs, die
 * der Client direkt nach dem Upload via `onFramesUploaded` erhält — ohne einen
 * zweiten `router.refresh()`. Das verhindert den src-Swap auf den <video>-Kacheln
 * (iOS-Compositing-Bug), der durch erneutes Signieren aller URLs ausgelöst wurde.
 *
 * Sobald der Server nach dem ersten `router.refresh()` (Video-Upload) die
 * server-seitigen frameUrls mitliefert, werden die supplementalen Einträge
 * bereinigt, um Duplikate zu vermeiden.
 */
export function MediaSection({
  orderId,
  businessId,
  initialItems,
  isDraft,
  maxVideoSeconds,
  photoMax,
  videoMax,
  photoCount,
  videoCount,
  hasBefore,
  hasAfter,
}: {
  orderId: string;
  businessId: string;
  initialItems: MediaWithUrl[];
  isDraft: boolean;
  maxVideoSeconds: number;
  photoMax: number;
  videoMax: number;
  photoCount: number;
  videoCount: number;
  hasBefore: boolean;
  hasAfter: boolean;
}) {
  // Supplementale Frame-URLs (keyed by media.id), die der Client-Upload direkt
  // liefert. Umgeht den zweiten router.refresh() nach der Frame-Extraktion.
  const [extraFrames, setExtraFrames] = useState<Map<string, string[]>>(
    new Map(),
  );

  // Stabile Referenz auf die aktuellen Items — der Callback liest daraus, ohne
  // bei jeder initialItems-Änderung neu erstellt werden zu müssen.
  const itemsRef = useRef<MediaWithUrl[]>(initialItems);
  useEffect(() => {
    itemsRef.current = initialItems;
  }, [initialItems]);

  // Sobald der Server nach dem ersten router.refresh() server-seitige frameUrls
  // mitliefert, den supplementalen Eintrag für dieses Medium entfernen.
  useEffect(() => {
    setExtraFrames((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      let changed = false;
      for (const item of initialItems) {
        if (item.frameUrls.length > 0 && next.has(item.id)) {
          next.delete(item.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [initialItems]);

  // Callback für Capture: Frame-URLs nach dem Upload direkt in den State schreiben.
  const handleFramesUploaded = useCallback(
    (videoStoragePath: string, frameUrls: string[]) => {
      const media = itemsRef.current.find(
        (m) => m.storage_path === videoStoragePath,
      );
      if (!media) return;
      setExtraFrames((prev) => {
        const next = new Map(prev);
        next.set(media.id, frameUrls);
        return next;
      });
    },
    [],
  );

  // Server-Items mit den supplementalen Frame-URLs zusammenführen.
  const mergedItems = useMemo(
    () =>
      extraFrames.size === 0
        ? initialItems
        : initialItems.map((item) => {
            const extra = extraFrames.get(item.id);
            if (!extra || extra.length === 0) return item;
            return { ...item, frameUrls: [...item.frameUrls, ...extra] };
          }),
    [initialItems, extraFrames],
  );

  // Brücke (0010): ein leerer Vorher/Nachher-Slot der MediaList startet den
  // Foto-Upload des Capture für seine Kategorie. Capture registriert seinen Opener
  // in diesem Ref; null, solange kein Capture gemountet ist (readOnly).
  const openPhotoControlRef = useRef<
    ((category: MediaCategory) => void) | null
  >(null);
  const requestPhotoForSlot = useCallback((category: "before" | "after") => {
    openPhotoControlRef.current?.(category);
  }, []);

  return (
    <>
      {isDraft ? (
        <Capture
          businessId={businessId}
          orderId={orderId}
          maxVideoSeconds={maxVideoSeconds}
          photoMax={photoMax}
          videoMax={videoMax}
          photoCount={photoCount}
          videoCount={videoCount}
          hasBefore={hasBefore}
          hasAfter={hasAfter}
          onFramesUploaded={handleFramesUploaded}
          openPhotoControlRef={openPhotoControlRef}
        />
      ) : null}
      <div style={{ marginTop: 16 }}>
        <MediaList
          orderId={orderId}
          items={mergedItems}
          readOnly={!isDraft}
          onRequestPhotoForSlot={requestPhotoForSlot}
        />
      </div>
    </>
  );
}
