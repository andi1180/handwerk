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
import type { OrderMedia } from "@/lib/orders/queries";

/** Medien-Item samt server-seitig erzeugter, befristeter Signed-URL (page.tsx). */
export type MediaWithUrl = OrderMedia & { signedUrl: string | null };

/** Wie lange ein Reorder-/Delete-Hinweis sichtbar bleibt (ms). */
const NOTICE_TIMEOUT_MS = 4000;

/**
 * Medien-Liste des Auftrags (Client Component) — Kern des **mobilen
 * Booklet-Assemblers**: quadratisches Kachel-Raster (Fotos und Videos gleich
 * groß), Reorder per Long-Press (dnd-kit), Löschen und **KI-Captions (6b)**.
 *
 * Captions: „Captions generieren" (Batch) füllt alle Medien OHNE Caption; das
 * Bearbeiten/Neu-Generieren pro Item läuft im Vollbild-Viewer (nicht in den
 * engen Kacheln). Jede Kachel zeigt einen dezenten Indikator hat-Caption/fehlt.
 *
 * Daten kommen server-seitig (RLS, `sort_order` ASC, Signed-URLs) als Props; der
 * lokale State erlaubt optimistische Mutationen. Wechselt die Prop-Liste (z. B.
 * nach Capture/Batch → `router.refresh()`), wird der State daraus neu gesetzt.
 *
 * ISOLATION: Alle Mutationen laufen über Route Handler, die `order_id`/Betrieb
 * gegen die Session prüfen; das Bild wird server-seitig (RLS) geladen.
 */
export function MediaList({
  orderId,
  items: initialItems,
}: {
  orderId: string;
  items: MediaWithUrl[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<MediaWithUrl[]>(initialItems);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // Prop-Liste → State, wenn der Server neu rendert (Capture-/Batch-Refresh,
  // Navigation). Eigene setState-Aufrufe ändern die Prop-Referenz nicht.
  useEffect(() => {
    setItems(initialItems);
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

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setTimeout(() => {
        draggedRef.current = false;
      }, 50);

      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = items.findIndex((m) => m.id === active.id);
      const newIndex = items.findIndex((m) => m.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;

      const previous = items;
      const reordered = arrayMove(items, oldIndex, newIndex);
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

  /** Batch: Captions für alle Medien OHNE Caption generieren. */
  const handleGenerate = useCallback(() => {
    setGenerating(true);
    void (async () => {
      try {
        const res = await fetch(`/api/portal/orders/${orderId}/captions`, {
          method: "POST",
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
        router.refresh();
      } catch {
        showNotice(t(DEFAULT_LOCALE, "captions.error"));
      } finally {
        setGenerating(false);
      }
    })();
  }, [orderId, router, showNotice]);

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

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 10,
        }}
      >
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>
          {t(DEFAULT_LOCALE, "assembler.reorderHint")}
        </p>
        <button
          type="button"
          className="btn-dark"
          onClick={handleGenerate}
          disabled={generating || missingCount === 0}
          style={{
            flexShrink: 0,
            opacity: generating || missingCount === 0 ? 0.6 : 1,
            cursor:
              generating || missingCount === 0 ? "default" : "pointer",
          }}
        >
          {generating
            ? t(DEFAULT_LOCALE, "captions.generating")
            : t(DEFAULT_LOCALE, "captions.generate")}
        </button>
      </div>

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
          items={items.map((m) => m.id)}
          strategy={rectSortingStrategy}
        >
          <div className="media-grid">
            {items.map((media) => (
              <SortableTile
                key={media.id}
                media={media}
                draggedRef={draggedRef}
                onView={() => setViewingId(media.id)}
                onDelete={() => handleDelete(media)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

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
          onClose={() => setViewingId(null)}
          onCaptionChange={applyCaption}
        />
      ) : null}
    </div>
  );
}

/** Eine sortierbare, quadratische Kachel: Foto/Video-Poster + Play/Tag/Caption/Löschen. */
function SortableTile({
  media,
  draggedRef,
  onView,
  onDelete,
}: {
  media: MediaWithUrl;
  draggedRef: React.RefObject<boolean>;
  onView: () => void;
  onDelete: () => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } =
    useSortable({ id: media.id });

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

  const hasCaption = Boolean(media.caption);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="media-tile"
      {...attributes}
      {...listeners}
      onClick={view}
      onKeyDown={(e) => {
        if (e.key === "Enter") view();
      }}
    >
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

      {/* Dezenter Caption-Indikator: gefüllt = hat Caption, schwach = fehlt. */}
      <span
        className="media-tile-caption"
        aria-label={
          hasCaption
            ? t(DEFAULT_LOCALE, "captions.edit")
            : t(DEFAULT_LOCALE, "captions.empty")
        }
        style={{
          background: hasCaption ? "var(--gold)" : "rgba(0, 0, 0, 0.45)",
          opacity: hasCaption ? 1 : 0.7,
        }}
      >
        <CaptionIcon />
      </span>

      {media.tag ? (
        <span className="media-tile-tag">{t(DEFAULT_LOCALE, `mediaTag.${media.tag}`)}</span>
      ) : null}

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
  onClose,
  onCaptionChange,
}: {
  media: MediaWithUrl;
  orderId: string;
  onClose: () => void;
  onCaptionChange: (id: string, caption: string) => void;
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

      {/* Medien-Bereich (füllt den Platz oberhalb des Caption-Panels). */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
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
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
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
                maxHeight: "100%",
                objectFit: "contain",
                borderRadius: "var(--radius)",
              }}
            />
          )
        ) : null}
      </div>

      {/* Caption-Editor: eigener key pro Item, damit der Text beim Wechsel neu lädt. */}
      <CaptionEditor
        key={media.id}
        orderId={orderId}
        media={media}
        onCaptionChange={onCaptionChange}
      />
    </div>
  );
}

/** Bearbeiten + Neu-Generieren der Caption (im Vollbild-Viewer, unter dem Medium). */
function CaptionEditor({
  orderId,
  media,
  onCaptionChange,
}: {
  orderId: string;
  media: MediaWithUrl;
  onCaptionChange: (id: string, caption: string) => void;
}) {
  const [text, setText] = useState(media.caption ?? "");
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [feedback, setFeedback] = useState<"saved" | "error" | null>(null);

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
        const data = (await res.json()) as { id: string; caption: string };
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

      {media.keyword ? (
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          {t(DEFAULT_LOCALE, "capture.keyword")}: {media.keyword}
        </span>
      ) : null}

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
        style={{ resize: "none" }}
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
            color: feedback === "error" ? "#B23B3B" : "var(--text-secondary)",
          }}
        >
          {feedback === "saved"
            ? t(DEFAULT_LOCALE, "captions.saved")
            : feedback === "error"
              ? t(DEFAULT_LOCALE, "captions.error")
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
