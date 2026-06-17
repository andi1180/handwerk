"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import { CAPTION_MAX_LENGTH } from "@/lib/ai/caption-limits";
import type { MediaCategory, OrderMedia } from "@/lib/orders/queries";

/** Auswählbare Kategorien im Viewer-Selektor in fester Reihenfolge (0010). */
const CATEGORY_OPTIONS: MediaCategory[] = ["before", "after", "process"];

/**
 * Medien-Item samt server-seitig erzeugter, befristeter Signed-URL (page.tsx).
 * `frameUrls` (Phase 1): signierte Vorschau-Frames eines Videos (Konventions-
 * Pfad, keine DB-Zeile); bei Fotos und framelosen Videos leer.
 */
export type MediaWithUrl = OrderMedia & {
  signedUrl: string | null;
  frameUrls: string[];
};

/** Wie lange ein Reorder-/Delete-Hinweis sichtbar bleibt (ms). */
const NOTICE_TIMEOUT_MS = 4000;

/**
 * Medien-Liste des Auftrags (Client Component) — Kern des **mobilen
 * Booklet-Assemblers**: quadratisches Kachel-Raster (Fotos und Videos gleich
 * groß), Reorder per Long-Press (dnd-kit), Löschen und **KI-Captions (6b)**.
 *
 * Captions: „Captions generieren" (Batch) beschriftet die **explizit
 * ausgewählten** (unbeschrifteten) Kacheln (6b.3) — ohne Auswahl ist der Button
 * deaktiviert. „Alle auswählen" merkt alle Medien ohne Caption vor, sodass „alle
 * captionen" zwei Taps bleibt. Das Bearbeiten/Neu-Generieren pro Item läuft im
 * Vollbild-Viewer (nicht in den engen Kacheln). Jede Kachel trägt oben links
 * **einen** Indikator: hat-Caption ⇒ Caption-Icon (Status); fehlt ⇒ tappbarer
 * Auswahl-Kreis (leer/gold) zum Vormerken für die Generierung.
 *
 * Daten kommen server-seitig (RLS, `sort_order` ASC, Signed-URLs) als Props; der
 * lokale State erlaubt optimistische Mutationen. Wechselt die Prop-Liste (z. B.
 * nach Capture/Batch → `router.refresh()`), wird der State daraus neu gesetzt.
 *
 * ISOLATION: Alle Mutationen laufen über Route Handler, die `order_id`/Betrieb
 * gegen die Session prüfen; das Bild wird server-seitig (RLS) geladen.
 *
 * `readOnly` (Abgeschlossen-Modus, 6c): blendet alle Mutations-Controls aus
 * (Reorder/Löschen/Caption-Edit/Batch). Ansehen/Abspielen bleibt.
 */
export function MediaList({
  orderId,
  items: initialItems,
  readOnly = false,
  onRequestPhotoForSlot,
}: {
  orderId: string;
  items: MediaWithUrl[];
  readOnly?: boolean;
  /**
   * Leeren Vorher/Nachher-Slot antippen → Foto-Upload für DIESE Kategorie (0010).
   * Wird vom Wrapper (MediaSection) an Capture verdrahtet; fehlt der Callback oder
   * ist `readOnly`, bleibt der Slot ein reiner Platzhalter.
   */
  onRequestPhotoForSlot?: (category: "before" | "after") => void;
}) {
  const router = useRouter();
  const [items, setItems] = useState<MediaWithUrl[]>(initialItems);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  // Für die Batch-Generierung vorgemerkte (unbeschriftete) Kacheln (6b.2).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Prop-Liste → State, wenn der Server neu rendert (Capture-/Batch-Refresh,
  // Navigation). Eigene setState-Aufrufe ändern die Prop-Referenz nicht.
  // Auswahl dabei auf weiterhin vorhandene, noch unbeschriftete Medien stutzen.
  useEffect(() => {
    setItems(initialItems);
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      for (const m of initialItems) {
        if (!m.caption && prev.has(m.id)) next.add(m.id);
      }
      return next;
    });
  }, [initialItems]);

  // Der gerade betrachtete Eintrag wird aus `items` abgeleitet, damit Caption-
  // Updates (Speichern/Neu generieren) sofort im Viewer sichtbar sind.
  const viewing = viewingId ? items.find((m) => m.id === viewingId) ?? null : null;

  // Hinweis nach kurzer Zeit automatisch ausblenden.
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_TIMEOUT_MS);
  }, []);
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  // Touch: Long-Press (~220ms) greift die Kachel — Tippen/Scrollen bleibt frei.
  // Maus: erst ein Zug von ≥8px startet das Reorder, ein Klick öffnet die Vorschau.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 220, tolerance: 8 },
    }),
  );

  // Nach einem echten Drag den unmittelbar folgenden Klick unterdrücken (sonst
  // würde das Loslassen die Vorschau öffnen). Flag kurz nach dem Drop zurücksetzen.
  const draggedRef = useRef(false);

  /** Caption eines Items lokal setzen (optimistisch, nach Save/Regenerate/Batch). */
  const applyCaption = useCallback((id: string, caption: string) => {
    const value = caption.length > 0 ? caption : null;
    setItems((prev) =>
      prev.map((m) => (m.id === id ? { ...m, caption: value } : m)),
    );
  }, []);

  /**
   * Kategorie eines Mediums wechseln (0010): optimistisch umsortieren (Gruppe
   * wechselt) → PATCH → bei Erfolg `router.refresh()` (server-abgeleitete Props
   * wie der Capture-Slot-Status aktualisieren), bei Fehler Rollback + Hinweis.
   */
  const handleCategoryChange = useCallback(
    (media: MediaWithUrl, category: MediaCategory) => {
      if (media.category === category) return;
      const previous = items;
      setItems((prev) =>
        prev.map((m) => (m.id === media.id ? { ...m, category } : m)),
      );
      void (async () => {
        try {
          const res = await fetch(
            `/api/portal/orders/${orderId}/media/${media.id}/category`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ category }),
            },
          );
          if (!res.ok) throw new Error("category_failed");
          router.refresh();
        } catch {
          setItems(previous); // zurückrollen
          showNotice(t(DEFAULT_LOCALE, "assembler.categoryError"));
        }
      })();
    },
    [items, orderId, router, showNotice],
  );

  /** Auswahl einer (unbeschrifteten) Kachel umschalten. */
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Alle Kacheln OHNE Caption vormerken (ein Tap vor „Captions generieren"). */
  const selectAll = useCallback(() => {
    setSelectedIds(new Set(items.filter((m) => !m.caption).map((m) => m.id)));
  }, [items]);

  /** Auswahl komplett aufheben. */
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setTimeout(() => {
        draggedRef.current = false;
      }, 50);

      const { active, over } = event;
      if (!over || active.id === over.id) return;

      // Reorder NUR innerhalb der process-Items — before/after sind fix
      // positioniert (0010) und nicht Teil des Sortable-Kontexts.
      const before = items.filter((m) => m.category === "before");
      const after = items.filter((m) => m.category === "after");
      const process = items.filter((m) => m.category === "process");
      const oldIndex = process.findIndex((m) => m.id === active.id);
      const newIndex = process.findIndex((m) => m.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;

      const previous = items;
      // Volles Set in Booklet-Ordnung (before → process → after) — die reorder-
      // Route verlangt exakt die Medien-Menge; sort_order folgt damit der
      // Render-Reihenfolge.
      const reordered = [
        ...before,
        ...arrayMove(process, oldIndex, newIndex),
        ...after,
      ];
      setItems(reordered); // optimistisch

      void (async () => {
        try {
          const res = await fetch(
            `/api/portal/orders/${orderId}/media/reorder`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ids: reordered.map((m) => m.id) }),
            },
          );
          if (!res.ok) throw new Error("reorder_failed");
        } catch {
          setItems(previous); // zurückrollen
          showNotice(t(DEFAULT_LOCALE, "assembler.reorderError"));
        }
      })();
    },
    [items, orderId, showNotice],
  );

  const handleDelete = useCallback(
    (media: MediaWithUrl) => {
      if (!window.confirm(t(DEFAULT_LOCALE, "assembler.deleteConfirm"))) return;

      const previous = items;
      setItems((prev) => prev.filter((m) => m.id !== media.id)); // optimistisch
      setSelectedIds((prev) => {
        if (!prev.has(media.id)) return prev;
        const next = new Set(prev);
        next.delete(media.id);
        return next;
      });
      if (viewingId === media.id) setViewingId(null);

      void (async () => {
        try {
          const res = await fetch(
            `/api/portal/orders/${orderId}/media/${media.id}`,
            { method: "DELETE" },
          );
          if (!res.ok) throw new Error("delete_failed");
          router.refresh(); // Server bestätigt; hält Reihenfolge/URLs konsistent
        } catch {
          setItems(previous); // zurückrollen
          showNotice(t(DEFAULT_LOCALE, "assembler.deleteError"));
        }
      })();
    },
    [items, orderId, router, showNotice, viewingId],
  );

  /**
   * Batch: Captions generieren — beschriftet **ausschließlich** die ausgewählten
   * (unbeschrifteten) Kacheln. Die Auswahl ist explizit (kein „leer ⇒ alle" mehr
   * im UI); der Button ist ohne Auswahl deaktiviert. Nach Erfolg wird die Auswahl
   * zurückgesetzt. Es werden immer konkrete `ids` gesendet.
   */
  const handleGenerate = useCallback(() => {
    const ids = items
      .filter((m) => !m.caption && selectedIds.has(m.id))
      .map((m) => m.id);
    if (ids.length === 0) return; // nichts ausgewählt → kein Request
    setGenerating(true);
    void (async () => {
      try {
        const res = await fetch(`/api/portal/orders/${orderId}/captions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) throw new Error("captions_failed");
        const data = (await res.json()) as {
          updated: { id: string; caption: string }[];
        };
        // Optimistisch sofort anzeigen; refresh reconciled mit dem Server.
        setItems((prev) =>
          prev.map((m) => {
            const hit = data.updated.find((u) => u.id === m.id);
            return hit ? { ...m, caption: hit.caption || null } : m;
          }),
        );
        setSelectedIds(new Set());
        router.refresh();
      } catch {
        showNotice(t(DEFAULT_LOCALE, "captions.error"));
      } finally {
        setGenerating(false);
      }
    })();
  }, [items, selectedIds, orderId, router, showNotice]);

  if (items.length === 0) {
    return (
      <div
        className="card"
        style={{
          textAlign: "center",
          padding: "32px 24px",
          color: "var(--text-secondary)",
        }}
      >
        {t(DEFAULT_LOCALE, "orderDetail.noMedia")}
      </div>
    );
  }

  const missingCount = items.filter((m) => !m.caption).length;
  const selectedCount = selectedIds.size;
  // Generieren nur mit expliziter Auswahl (kein „leer ⇒ alle" mehr).
  const disableGenerate = generating || selectedCount === 0;

  // Gruppierung (0010): before/after je max 1 (fest positioniert), process der
  // Rest in sort_order (verschiebbar). Das Booklet rendert before → process →
  // after (lib/booklet/media-order.ts).
  const beforeItem = items.find((m) => m.category === "before") ?? null;
  const afterItem = items.find((m) => m.category === "after") ?? null;
  const processItems = items.filter((m) => m.category === "process");

  return (
    <div>
      {/* Sanfte Trennlinie zwischen dem Capture-Button-Block (darüber) und der
          Aktionszeile. Nur wenn mindestens ein Medium da ist — sonst würde sie
          eine leere Zeile abtrennen. */}
      {!readOnly && items.length > 0 ? (
        <hr className="media-section-divider" />
      ) : null}
      {/* Aktions-Kopf — im Abgeschlossen-Modus ausgeblendet. Enthält nur noch zwei
          gleich breite Buttons („Alle auswählen" + „Captions generieren"), die auf
          schmalen Viewports umbrechen statt überzulaufen. Gilt für ALLE Medien
          (Vorher/Nachher + Prozess). Der Reorder-Hinweis sitzt als dezenter Text
          UNTER dem Prozess-Raster (siehe unten). */}
      {!readOnly ? (
        <div style={{ marginBottom: 10 }}>
          {selectedCount > 0 ? (
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
            >
              {t(DEFAULT_LOCALE, "captions.selected", { count: selectedCount })}
            </p>
          ) : null}
          <div className="media-actions">
            {/* Toggle: nichts ausgewählt ⇒ „Alle auswählen" (alle ohne Caption);
                etwas ausgewählt ⇒ „Auswahl aufheben". So bleibt „alle captionen"
                = zwei Taps. Versteckt, wenn nichts zu beschriften ist. */}
            {missingCount > 0 ? (
              <button
                type="button"
                className="btn-outline media-action-btn"
                onClick={selectedCount > 0 ? clearSelection : selectAll}
              >
                {selectedCount > 0
                  ? t(DEFAULT_LOCALE, "captions.deselectAll")
                  : t(DEFAULT_LOCALE, "captions.selectAll")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn-dark media-action-btn"
              onClick={handleGenerate}
              disabled={disableGenerate}
              style={{
                opacity: disableGenerate ? 0.6 : 1,
                cursor: disableGenerate ? "default" : "pointer",
              }}
            >
              {generating
                ? t(DEFAULT_LOCALE, "captions.generating")
                : selectedCount > 0
                  ? t(DEFAULT_LOCALE, "captions.generateSelected", {
                      count: selectedCount,
                    })
                  : t(DEFAULT_LOCALE, "captions.generate")}
            </button>
          </div>
        </div>
      ) : null}

      {/* Vorher / Nachher (0010): zwei große, fixe Slots nebeneinander. Leerer
          Slot = Platzhalter; gefüllter Slot = das Bild (klick = ansehen, mit
          Auswahl-/Caption-Indikator + Löschen wie eine Prozess-Kachel). NICHT
          verschiebbar. */}
      <div className="media-ba-row">
        <BeforeAfterSlot
          category="before"
          media={beforeItem}
          readOnly={readOnly}
          selected={beforeItem ? selectedIds.has(beforeItem.id) : false}
          onToggleSelect={() => beforeItem && toggleSelect(beforeItem.id)}
          onView={() => beforeItem && setViewingId(beforeItem.id)}
          onDelete={() => beforeItem && handleDelete(beforeItem)}
          onAddPhoto={
            onRequestPhotoForSlot
              ? () => onRequestPhotoForSlot("before")
              : undefined
          }
        />
        <BeforeAfterSlot
          category="after"
          media={afterItem}
          readOnly={readOnly}
          selected={afterItem ? selectedIds.has(afterItem.id) : false}
          onToggleSelect={() => afterItem && toggleSelect(afterItem.id)}
          onView={() => afterItem && setViewingId(afterItem.id)}
          onDelete={() => afterItem && handleDelete(afterItem)}
          onAddPhoto={
            onRequestPhotoForSlot
              ? () => onRequestPhotoForSlot("after")
              : undefined
          }
        />
      </div>

      {/* Prozess: Sektions-Überschrift + das bisherige Raster (nur process-Items,
          per Long-Press verschiebbar). */}
      <h3 className="media-section-title">
        {t(DEFAULT_LOCALE, "mediaCategory.process")}
      </h3>
      {processItems.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={() => {
            draggedRef.current = true;
          }}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            setTimeout(() => {
              draggedRef.current = false;
            }, 50);
          }}
        >
          <SortableContext
            items={processItems.map((m) => m.id)}
            strategy={rectSortingStrategy}
          >
            <div className="media-grid">
              {processItems.map((media) => (
                <SortableTile
                  key={media.id}
                  media={media}
                  draggedRef={draggedRef}
                  readOnly={readOnly}
                  selected={selectedIds.has(media.id)}
                  onToggleSelect={() => toggleSelect(media.id)}
                  onView={() => setViewingId(media.id)}
                  onDelete={() => handleDelete(media)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : !readOnly ? (
        <p className="media-process-empty">
          {t(DEFAULT_LOCALE, "assembler.processEmpty")}
        </p>
      ) : null}

      {/* Dezenter Bedien-Hinweis unter dem Raster (kein Button) — nur wenn es
          überhaupt etwas zu verschieben gibt und nicht im Abgeschlossen-Modus. */}
      {!readOnly && processItems.length > 1 ? (
        <p className="media-reorder-hint">
          {t(DEFAULT_LOCALE, "assembler.reorderHint")}
        </p>
      ) : null}

      {notice ? (
        <div
          role="alert"
          className="card"
          style={{
            marginTop: 12,
            padding: 12,
            fontSize: 13,
            color: "#B23B3B",
            borderColor: "var(--border)",
          }}
        >
          {notice}
        </div>
      ) : null}

      {viewing ? (
        <MediaViewer
          media={viewing}
          orderId={orderId}
          readOnly={readOnly}
          onClose={() => setViewingId(null)}
          onCaptionChange={applyCaption}
          onCategoryChange={handleCategoryChange}
          disableBefore={Boolean(beforeItem && beforeItem.id !== viewing.id)}
          disableAfter={Boolean(afterItem && afterItem.id !== viewing.id)}
        />
      ) : null}
    </div>
  );
}

/**
 * Gemeinsamer Kachel-Inhalt: Foto/Video-Poster + Play-Overlay, oben links **ein**
 * Indikator (Caption-Status bzw. Auswahl-Kreis), oben rechts der Lösch-Button.
 * Genutzt von der verschiebbaren Prozess-Kachel (`SortableTile`) UND den fixen
 * Vorher/Nachher-Slots (`BeforeAfterSlot`, 0010) — die Drag-/Positions-Logik
 * liegt im jeweiligen Wrapper, damit der Inhalt nicht dupliziert wird.
 */
function TileVisual({
  media,
  readOnly,
  selected,
  onToggleSelect,
  onDelete,
}: {
  media: MediaWithUrl;
  readOnly: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
}) {
  const hasCaption = Boolean(media.caption);
  return (
    <>
      {media.media_type === "photo" && media.signedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Signed-URL aus privatem Bucket, kein next/image-Remote-Pattern nötig.
        <img src={media.signedUrl} alt={media.keyword ?? ""} />
      ) : media.media_type === "video" && media.signedUrl ? (
        // `#t=0.1` zeigt das erste Frame als Poster (Fragment geht nicht an den Server, Signatur bleibt gültig).
        <video src={`${media.signedUrl}#t=0.1`} muted playsInline preload="metadata" />
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
          }}
        >
          <MediaTypeIcon type={media.media_type} size={28} />
        </div>
      )}

      {media.media_type === "video" ? (
        <div className="media-tile-play" aria-hidden>
          <span>
            <PlayIcon />
          </span>
        </div>
      ) : null}

      {/* Ein Indikator oben links (6b.2): hat Caption ⇒ Caption-Icon (Status);
          fehlt ⇒ tappbarer Auswahl-Kreis (leer/gold) für die Batch-Generierung.
          Im Abgeschlossen-Modus ohne Caption: kein Indikator. */}
      {hasCaption ? (
        <span
          className="media-tile-indicator media-tile-indicator--caption"
          aria-label={t(DEFAULT_LOCALE, "captions.edit")}
        >
          <CaptionIcon />
        </span>
      ) : !readOnly ? (
        <div
          role="button"
          tabIndex={0}
          aria-pressed={selected}
          aria-label={t(DEFAULT_LOCALE, "captions.select")}
          className={`media-tile-indicator media-tile-indicator--select${
            selected ? " is-selected" : ""
          }`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              onToggleSelect();
            }
          }}
        >
          {selected ? <CheckIcon /> : null}
        </div>
      ) : null}

      {!readOnly ? (
        <div
          role="button"
          tabIndex={0}
          aria-label={t(DEFAULT_LOCALE, "assembler.delete")}
          className="media-tile-delete"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              onDelete();
            }
          }}
        >
          <TrashIcon />
        </div>
      ) : null}
    </>
  );
}

/**
 * Eine sortierbare, quadratische **Prozess**-Kachel. Tap (kein vorangegangener
 * Drag) = ansehen/abspielen; Long-Press = verschieben (dnd-kit). Inhalt via
 * `TileVisual`. before/after laufen NICHT hier durch — sie sind fix (s.
 * `BeforeAfterSlot`).
 */
function SortableTile({
  media,
  draggedRef,
  readOnly,
  selected,
  onToggleSelect,
  onView,
  onDelete,
}: {
  media: MediaWithUrl;
  draggedRef: React.RefObject<boolean>;
  readOnly: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onView: () => void;
  onDelete: () => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } =
    useSortable({ id: media.id, disabled: readOnly });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 2 : undefined,
  };

  // Tap (kein vorangegangener Drag) = ansehen/abspielen.
  const view = () => {
    if (draggedRef.current) return;
    onView();
  };

  // Read-only: keine Drag-Listener (nur Ansehen), kein Lösch-Button.
  const dragProps = readOnly ? {} : { ...attributes, ...listeners };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="media-tile"
      {...dragProps}
      onClick={view}
      onKeyDown={(e) => {
        if (e.key === "Enter") view();
      }}
    >
      <TileVisual
        media={media}
        readOnly={readOnly}
        selected={selected}
        onToggleSelect={onToggleSelect}
        onDelete={onDelete}
      />
    </div>
  );
}

/**
 * Fixer **Vorher-/Nachher-Slot** (0010): leerer Platzhalter (mit Label + Hinweis)
 * oder das gefüllte Bild als große Kachel mit Label-Band unten. NICHT
 * verschiebbar; im gefüllten Zustand verhält es sich wie eine Prozess-Kachel
 * (ansehen/auswählen/löschen via `TileVisual`).
 */
function BeforeAfterSlot({
  category,
  media,
  readOnly,
  selected,
  onToggleSelect,
  onView,
  onDelete,
  onAddPhoto,
}: {
  category: "before" | "after";
  media: MediaWithUrl | null;
  readOnly: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onView: () => void;
  onDelete: () => void;
  /** Leeren Slot antippen → Foto-Upload für DIESE Kategorie (0010). */
  onAddPhoto?: () => void;
}) {
  const label = t(DEFAULT_LOCALE, `mediaCategory.${category}`);

  if (!media) {
    // Editier-Modus: der leere Slot ist tappbar und startet den Foto-Upload für
    // genau diese Kategorie. Abgeschlossen-Modus (readOnly) bzw. ohne Handler:
    // reiner Platzhalter wie bisher.
    if (!readOnly && onAddPhoto) {
      return (
        <div
          className="media-ba-slot media-ba-empty media-ba-empty--add"
          role="button"
          tabIndex={0}
          aria-label={t(DEFAULT_LOCALE, "assembler.slotAdd", { category: label })}
          onClick={onAddPhoto}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onAddPhoto();
            }
          }}
        >
          <span className="media-ba-empty-label">{label}</span>
          <PlusIcon />
          <span className="media-ba-empty-hint">
            {t(DEFAULT_LOCALE, "assembler.slotAddHint")}
          </span>
        </div>
      );
    }
    return (
      <div className="media-ba-slot media-ba-empty">
        <span className="media-ba-empty-label">{label}</span>
        <span className="media-ba-empty-hint">
          {t(DEFAULT_LOCALE, "assembler.slotEmpty")}
        </span>
      </div>
    );
  }

  return (
    <div
      className="media-tile media-ba-slot"
      role="button"
      tabIndex={0}
      onClick={onView}
      onKeyDown={(e) => {
        if (e.key === "Enter") onView();
      }}
    >
      <TileVisual
        media={media}
        readOnly={readOnly}
        selected={selected}
        onToggleSelect={onToggleSelect}
        onDelete={onDelete}
      />
      <span className="media-ba-label">{label}</span>
    </div>
  );
}

/**
 * Vergrößerte Vorschau (Vollbild-Overlay): Foto groß bzw. Video mit Steuerung,
 * darunter der Caption-Editor (Bearbeiten + Neu generieren).
 */
function MediaViewer({
  media,
  orderId,
  readOnly,
  onClose,
  onCaptionChange,
  onCategoryChange,
  disableBefore,
  disableAfter,
}: {
  media: MediaWithUrl;
  orderId: string;
  readOnly: boolean;
  onClose: () => void;
  onCaptionChange: (id: string, caption: string) => void;
  onCategoryChange: (media: MediaWithUrl, category: MediaCategory) => void;
  /** Vorher-Slot durch ein ANDERES Medium belegt ⇒ Auswahl gesperrt (0010). */
  disableBefore: boolean;
  /** Nachher-Slot durch ein ANDERES Medium belegt ⇒ Auswahl gesperrt (0010). */
  disableAfter: boolean;
}) {
  // Escape schließt das Overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        background: "rgba(0, 0, 0, 0.82)",
      }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={t(DEFAULT_LOCALE, "assembler.close")}
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onClose();
        }}
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          zIndex: 1,
          width: 40,
          height: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 999,
          background: "rgba(0, 0, 0, 0.5)",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        <CloseIcon />
      </div>

      {/* Medien-Bereich. Kein flex:1 mehr — die Panels darunter müssen auf kurzen
          Handy-Schirmen erreichbar sein; der Viewer-Container scrollt (overflowY
          auto). maxHeight:55dvh begrenzt das Medium, damit die Panels sichtbar
          bleiben, ohne scrollen zu müssen. */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
      >
        {media.signedUrl ? (
          media.media_type === "video" ? (
            <video
              src={media.signedUrl}
              controls
              autoPlay
              playsInline
              muted
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: "100%",
                maxHeight: "55dvh",
                borderRadius: "var(--radius)",
                background: "#000",
              }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- Signed-URL aus privatem Bucket.
            <img
              src={media.signedUrl}
              alt={media.keyword ?? ""}
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: "100%",
                maxHeight: "55dvh",
                objectFit: "contain",
                borderRadius: "var(--radius)",
              }}
            />
          )
        ) : null}
      </div>

      {/* Verifizier-Ansicht (Phase 1): bei Videos die extrahierten Vorschau-
          Frames als kleine Thumbnails — damit am iPhone sichtbar ist, dass echte
          (nicht schwarze) Frames entstanden sind. Reine Anzeige. */}
      {media.media_type === "video" && media.frameUrls.length > 0 ? (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: "var(--surface)",
            borderTop: "1px solid var(--border)",
            padding: "10px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {t(DEFAULT_LOCALE, "assembler.videoFrames")}
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {media.frameUrls.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- Signed-URL aus privatem Bucket.
              <img
                key={i}
                src={url}
                alt=""
                style={{
                  width: 72,
                  height: 96,
                  objectFit: "cover",
                  borderRadius: "var(--radius)",
                  background: "var(--surface-2)",
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Kategorie-Wechsel (0010) — nur Foto im Editier-Modus. Video bleibt
          immer 'process' (kein Selektor). Belegte before/after-Slots sind
          deaktiviert (Server prüft zusätzlich). */}
      {!readOnly && media.media_type === "photo" ? (
        <CategorySelector
          media={media}
          disableBefore={disableBefore}
          disableAfter={disableAfter}
          onCategoryChange={onCategoryChange}
        />
      ) : null}

      {/* Caption: editierbar im Entwurf, sonst read-only (Abgeschlossen-Modus, 6c).
          Eigener key pro Item, damit der Text beim Wechsel neu lädt. */}
      {readOnly ? (
        <CaptionReadOnly media={media} />
      ) : (
        <CaptionEditor
          key={media.id}
          orderId={orderId}
          media={media}
          onCaptionChange={onCaptionChange}
          onClose={onClose}
        />
      )}
    </div>
  );
}

/** Kategorie-Selektor im Viewer (0010): Vorher/Nachher/Prozess als Toggle-Reihe. */
function CategorySelector({
  media,
  disableBefore,
  disableAfter,
  onCategoryChange,
}: {
  media: MediaWithUrl;
  disableBefore: boolean;
  disableAfter: boolean;
  onCategoryChange: (media: MediaWithUrl, category: MediaCategory) => void;
}) {
  const disabledFor: Record<MediaCategory, boolean> = {
    before: disableBefore,
    after: disableAfter,
    process: false,
  };
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: "var(--surface)",
        borderTop: "1px solid var(--border)",
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600 }}>
        {t(DEFAULT_LOCALE, "assembler.categoryLabel")}
      </span>
      <div className="capture-category">
        {CATEGORY_OPTIONS.map((option) => {
          const active = media.category === option;
          const disabled = !active && disabledFor[option];
          return (
            <button
              key={option}
              type="button"
              className="capture-category-btn"
              data-active={active}
              disabled={disabled}
              onClick={() => onCategoryChange(media, option)}
            >
              {t(DEFAULT_LOCALE, `mediaCategory.${option}`)}
              {disabled ? (
                <span className="capture-category-taken">
                  {t(DEFAULT_LOCALE, "capture.categoryTaken")}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Read-only-Anzeige der Caption (Abgeschlossen-Modus) — kein Edit, kein KI-Button. */
function CaptionReadOnly({ media }: { media: MediaWithUrl }) {
  // Spiegelt displayCaption (caption ?? keyword) — das ist, was der Kunde im
  // Booklet/Reel sieht; ohne beides bleibt es der „leer"-Hinweis.
  const shown = media.caption ?? media.keyword;
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: "var(--surface)",
        borderTop: "1px solid var(--border)",
        padding: "12px 16px",
        paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600 }}>
        {t(DEFAULT_LOCALE, "captions.edit")}
      </span>
      <span
        style={{
          fontSize: 14,
          color: shown ? "var(--text-primary)" : "var(--text-secondary)",
        }}
      >
        {shown ?? t(DEFAULT_LOCALE, "captions.empty")}
      </span>
    </div>
  );
}

/** Bearbeiten + Neu-Generieren der Caption (im Vollbild-Viewer, unter dem Medium). */
function CaptionEditor({
  orderId,
  media,
  onCaptionChange,
  onClose,
}: {
  orderId: string;
  media: MediaWithUrl;
  onCaptionChange: (id: string, caption: string) => void;
  onClose?: () => void;
}) {
  // Vorbefüllung: bereits gespeicherte Caption, sonst das bei der Aufnahme
  // getippte Stichwort (`keyword`) als initialer, frei editierbarer Text. So
  // steht der Text direkt IM Feld statt als separate Zeile über einem leeren
  // Feld. Speichern macht daraus eine echte Caption; ohne Speichern bleibt
  // `caption` null (Kachel bleibt KI-wählbar, Booklet zeigt das Stichwort via
  // displayCaption). KI-Generierung überschreibt das Feld später komplett.
  const [text, setText] = useState(media.caption ?? media.keyword ?? "");
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [feedback, setFeedback] = useState<"saved" | "error" | "emptyResult" | null>(null);

  const busy = saving || regenerating;

  const handleSave = useCallback(() => {
    setSaving(true);
    setFeedback(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/portal/orders/${orderId}/media/${media.id}/caption`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ caption: text }),
          },
        );
        if (!res.ok) throw new Error("save_failed");
        const data = (await res.json()) as { id: string; caption: string };
        setText(data.caption);
        onCaptionChange(media.id, data.caption);
        setFeedback("saved");
        onClose?.();
      } catch {
        setFeedback("error");
      } finally {
        setSaving(false);
      }
    })();
  }, [orderId, media.id, text, onCaptionChange]);

  const handleRegenerate = useCallback(() => {
    setRegenerating(true);
    setFeedback(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/portal/orders/${orderId}/media/${media.id}/caption/regenerate`,
          { method: "POST" },
        );
        if (!res.ok) throw new Error("regenerate_failed");
        const data = (await res.json()) as {
          id: string;
          caption: string | null;
          empty?: boolean;
        };
        // Leeres Ergebnis (isMetaResponse-Fehlalarm, Video ohne Frames/Stichwort,
        // …): Feld und DB-Caption bleiben unangetastet — kein destruktiver Apply.
        if (data.empty || !data.caption) {
          setFeedback("emptyResult");
          return;
        }
        setText(data.caption);
        onCaptionChange(media.id, data.caption);
      } catch {
        setFeedback("error");
      } finally {
        setRegenerating(false);
      }
    })();
  }, [orderId, media.id, onCaptionChange]);

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: "var(--surface)",
        borderTop: "1px solid var(--border)",
        padding: "12px 16px",
        paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {t(DEFAULT_LOCALE, "captions.edit")}
        </span>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={busy}
          aria-label={t(DEFAULT_LOCALE, "captions.regenerate")}
          title={t(DEFAULT_LOCALE, "captions.regenerate")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-secondary)",
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          <RegenerateIcon spinning={regenerating} />
          <span>{t(DEFAULT_LOCALE, "captions.regenerate")}</span>
        </button>
      </div>

      <textarea
        className="form-input"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setFeedback(null);
        }}
        maxLength={CAPTION_MAX_LENGTH}
        rows={2}
        placeholder={t(DEFAULT_LOCALE, "captions.empty")}
        disabled={busy}
        style={{ resize: "none", opacity: busy ? 0.6 : 1 }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span
          style={{
            fontSize: 13,
            minHeight: 18,
            color:
              feedback === "error"
                ? "#B23B3B"
                : feedback === "emptyResult"
                  ? "var(--text-secondary)"
                  : "var(--text-secondary)",
          }}
        >
          {feedback === "saved"
            ? t(DEFAULT_LOCALE, "captions.saved")
            : feedback === "error"
              ? t(DEFAULT_LOCALE, "captions.error")
              : feedback === "emptyResult"
                ? t(DEFAULT_LOCALE, "captions.emptyResult")
                : ""}
        </span>
        <button
          type="button"
          className="btn-gold"
          onClick={handleSave}
          disabled={busy}
          style={{ opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}
        >
          {t(DEFAULT_LOCALE, "captions.save")}
        </button>
      </div>
    </div>
  );
}

/** Schlichtes Inline-SVG-Icon für den Medientyp (Foto/Video). Reine Deko. */
function MediaTypeIcon({
  type,
  size,
}: {
  type: "photo" | "video";
  size: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style: { color: "var(--text-secondary)" },
    "aria-hidden": true,
  };
  if (type === "video") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
      <circle cx="12" cy="13.5" r="3.2" />
    </svg>
  );
}

/** Play-Dreieck im Video-Overlay. Reine Deko. */
function PlayIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

/** Caption-Indikator (Untertitel-Linien). Reine Deko. */
function CaptionIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 8h14M5 12h9M5 16h12" />
    </svg>
  );
}

/** Häkchen im gefüllten Gold-Kreis (ausgewählte, unbeschriftete Kachel). Deko. */
function CheckIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12l5 5 9-11" />
    </svg>
  );
}

/** Plus-Icon für den leeren, tappbaren Vorher/Nachher-Slot (0010). Reine Deko. */
function PlusIcon() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ color: "var(--text-secondary)" }}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Refresh-/Neu-generieren-Icon; dreht sich während der Generierung. */
function RegenerateIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={spinning ? { animation: "spin 0.9s linear infinite" } : undefined}
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

/** Mülleimer-Icon für den Lösch-Button. Reine Deko. */
function TrashIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}

/** X-Icon zum Schließen der Vorschau. Reine Deko. */
function CloseIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
