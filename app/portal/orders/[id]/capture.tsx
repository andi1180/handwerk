"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/media/compress";
import { getVideoDuration } from "@/lib/media/video";
import { MAX_VIDEO_SECONDS } from "@/lib/media/constants";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/** Medientyp einer Aufnahme (Foto in 4b, Video in 4c). */
type MediaType = "photo" | "video";

/** Browser-Client (anon-Key, RLS) — pro Komponenteninstanz einmal erzeugt. */
type BrowserClient = ReturnType<typeof createClient>;

/** Retry-Verhalten des Hintergrund-Uploads (Direktupload in den Storage). */
const UPLOAD_MAX_ATTEMPTS = 3; // 1 Versuch + bis zu 2 Retries
const UPLOAD_BACKOFF_MS = 800; // wächst linear pro Versuch

/** Noch nicht gespeicherte Aufnahme (lokale Vorschau + Eingaben). */
type Draft = {
  file: File;
  objectUrl: string;
  mediaType: MediaType;
  durationSeconds: number | null; // nur bei Video gesetzt
  keyword: string;
};

/** Ein in der In-Memory-Queue laufendes (optimistisches) Upload-Item. */
type PendingItem = {
  id: string; // lokaler Schlüssel für React + Queue-Operationen
  storagePath: string; // {businessId}/{orderId}/{uuid}.{ext} (einmalig vergeben)
  objectUrl: string; // lokale Vorschau (Original-Aufnahme)
  file: File; // Original — Foto wird neu komprimiert, Video unverändert
  mediaType: MediaType;
  durationSeconds: number | null; // nur bei Video gesetzt
  keyword: string | null;
  status: "uploading" | "error";
};

/** Dateiendung für den Storage-Pfad eines Videos (aus dem MIME-Subtyp). */
function videoExtension(file: File): string {
  const subtype = file.type.split("/")[1]?.toLowerCase();
  if (subtype === "quicktime") return "mov";
  if (subtype && /^[a-z0-9]+$/.test(subtype)) return subtype;
  return "mp4";
}

/** Pause (ms) — kurzer Backoff zwischen Upload-Versuchen. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Dauerhafter (nicht erneut versuchbarer) Fehler — z. B. HTTP 4xx vom Metadaten-
 * POST (ungültiger Body/Pfad). Ein Retry würde nichts ändern, daher sofort werfen.
 */
class PermanentError extends Error {}

/**
 * Lädt den Blob direkt in den privaten Bucket `order-media` (BROWSER-Client,
 * authenticated → Storage-RLS bindet das erste Pfad-Segment an die business_id).
 * Bei Fehlern bis zu 2 Retries mit kurzem Backoff; danach wirft die Funktion.
 * `upsert` lässt einen Retry einen evtl. halb hochgeladenen Pfad überschreiben.
 */
async function uploadWithRetry(
  supabase: BrowserClient,
  path: string,
  blob: Blob,
  contentType: string,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < UPLOAD_MAX_ATTEMPTS; attempt++) {
    const { error } = await supabase.storage
      .from("order-media")
      .upload(path, blob, { contentType, upsert: true });
    if (!error) return;
    lastError = error;
    if (attempt < UPLOAD_MAX_ATTEMPTS - 1) {
      await delay(UPLOAD_BACKOFF_MS * (attempt + 1));
    }
  }
  throw lastError ?? new Error("upload_failed");
}

/**
 * Schickt die Metadaten an den Route Handler — **zweiter** Schritt des Uploads.
 * Transiente Fehler (Netzwerk-Ausfall, HTTP 5xx) werden bis zu 2× mit Backoff
 * wiederholt; dauerhafte 4xx (ungültiger Body/Pfad) werfen sofort `PermanentError`
 * (Retry zwecklos). Nach Ausschöpfen der Versuche wirft die Funktion.
 */
async function postMetadataWithRetry(
  orderId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < UPLOAD_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`/api/portal/orders/${orderId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadata),
      });
      if (res.ok) return;
      // 4xx ⇒ dauerhaft (Body/Pfad), nicht erneut versuchen.
      if (res.status >= 400 && res.status < 500) {
        const detail = await res.text().catch(() => "");
        throw new PermanentError(
          `HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
        );
      }
      lastError = new Error(`HTTP ${res.status}`); // 5xx → transient
    } catch (err) {
      if (err instanceof PermanentError) throw err;
      lastError = err; // Netzwerkfehler → transient
    }
    if (attempt < UPLOAD_MAX_ATTEMPTS - 1) {
      await delay(UPLOAD_BACKOFF_MS * (attempt + 1));
    }
  }
  throw lastError ?? new Error("metadata_post_failed");
}

/**
 * Foto-Capture (Client Component). Native Kamera → Vorschau + Stichwort/Tag →
 * Hintergrund-Upload (zweistufig: Datei in Storage, danach Metadaten via Route
 * Handler). Mehrere Items parallel in einer In-Memory-Queue; bei Erfolg führt
 * `router.refresh()` das Item in die server-gerenderte Liste über.
 *
 * ISOLATION: Der Metadaten-POST schickt KEINE `business_id` — sie wird im Route
 * Handler aus der Session abgeleitet und gegen den `storage_path` validiert.
 */
export function Capture({
  businessId,
  orderId,
  maxVideoSeconds = MAX_VIDEO_SECONDS,
}: {
  businessId: string;
  orderId: string;
  /** Pro Betrieb konfiguriert (Settings); fällt auf die Konstante zurück. */
  maxVideoSeconds?: number;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  // Galerie-/Datei-Auswahl (ohne `capture` → kein Kamera-Zwang) — gleiche Pipeline.
  const photoUploadInputRef = useRef<HTMLInputElement>(null);
  const videoUploadInputRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [items, setItems] = useState<PendingItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null); // z. B. Video zu lang

  // Spiegel für die Unmount-Bereinigung (objectURLs freigeben).
  const itemsRef = useRef<PendingItem[]>([]);
  const draftRef = useRef<Draft | null>(null);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(
    () => () => {
      itemsRef.current.forEach((it) => URL.revokeObjectURL(it.objectUrl));
      if (draftRef.current) URL.revokeObjectURL(draftRef.current.objectUrl);
    },
    [],
  );

  const runUpload = useCallback(
    async (item: PendingItem) => {
      setItems((prev) =>
        prev.map((it) =>
          it.id === item.id ? { ...it, status: "uploading" } : it,
        ),
      );
      const markError = () =>
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id ? { ...it, status: "error" } : it,
          ),
        );
      const ctx = `order ${orderId}, ${item.storagePath}`;

      // Schritt 0 — Body je Medientyp aufbereiten: Foto wird komprimiert (Maße),
      // Video unverändert hochgeladen (Dauer als Metadatum).
      let blob: Blob;
      let contentType: string;
      let metadata: Record<string, unknown>;
      try {
        if (item.mediaType === "video") {
          blob = item.file;
          contentType = item.file.type || "video/mp4";
          metadata = {
            storage_path: item.storagePath,
            media_type: "video",
            duration_seconds: item.durationSeconds,
            keyword: item.keyword,
          };
        } else {
          const compressed = await compressImage(item.file);
          blob = compressed.blob;
          contentType = "image/jpeg";
          metadata = {
            storage_path: item.storagePath,
            media_type: "photo",
            keyword: item.keyword,
            width: compressed.width,
            height: compressed.height,
          };
        }
      } catch (err) {
        console.error(`[capture] Bildaufbereitung fehlgeschlagen (${ctx}):`, err);
        markError();
        return;
      }

      // Schritt 1 — Storage-Upload (Retry in uploadWithRetry). Schlägt das fehl,
      // liegt KEINE Datei verlässlich im Bucket ⇒ kein Cleanup nötig.
      try {
        await uploadWithRetry(supabase, item.storagePath, blob, contentType);
      } catch (err) {
        console.error(`[capture] Storage-Upload fehlgeschlagen (${ctx}):`, err);
        markError();
        return;
      }

      // Schritt 2 — Metadaten-POST (eigener Retry für transiente Fehler).
      // Endgültiger Fehler ⇒ die bereits hochgeladene Datei wieder entfernen,
      // damit kein verwaistes File bleibt und ein erneuter Versuch sauber startet.
      try {
        await postMetadataWithRetry(orderId, metadata);
      } catch (err) {
        console.error(`[capture] Metadaten-POST fehlgeschlagen (${ctx}):`, err);
        const { error: removeError } = await supabase.storage
          .from("order-media")
          .remove([item.storagePath]);
        if (removeError) {
          console.error(
            `[capture] Orphan-Cleanup fehlgeschlagen (${ctx}):`,
            removeError,
          );
        }
        markError();
        return;
      }

      // Erfolg: optimistisches Item entfernen, Server-Liste neu laden.
      setItems((prev) => {
        const done = prev.find((it) => it.id === item.id);
        if (done) URL.revokeObjectURL(done.objectUrl);
        return prev.filter((it) => it.id !== item.id);
      });
      router.refresh();
    },
    [supabase, orderId, router],
  );

  const openPhoto = () => photoInputRef.current?.click();
  const openVideo = () => videoInputRef.current?.click();
  const openPhotoUpload = () => photoUploadInputRef.current?.click();
  const openVideoUpload = () => videoUploadInputRef.current?.click();

  /** Verwirft einen evtl. offenen Entwurf und setzt den neuen Entwurf. */
  const replaceDraft = (next: Draft) => {
    if (draft) URL.revokeObjectURL(draft.objectUrl);
    setNotice(null);
    setDraft(next);
  };

  const handlePhotoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // erlaubt erneute Auswahl derselben Datei
    if (!file) return;
    replaceDraft({
      file,
      objectUrl: URL.createObjectURL(file),
      mediaType: "photo",
      durationSeconds: null,
      keyword: "",
    });
  };

  const handleVideoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // erlaubt erneute Auswahl derselben Datei
    if (!file) return;

    // Längen-Check NACH der Aufnahme — zu lang ⇒ ablehnen, kein Upload, kein Trim.
    let duration: number;
    try {
      duration = await getVideoDuration(file);
    } catch {
      setNotice(t(DEFAULT_LOCALE, "capture.error"));
      return;
    }
    if (duration > maxVideoSeconds) {
      setNotice(
        t(DEFAULT_LOCALE, "capture.videoTooLong", { max: maxVideoSeconds }),
      );
      return;
    }

    replaceDraft({
      file,
      objectUrl: URL.createObjectURL(file),
      mediaType: "video",
      durationSeconds: duration,
      keyword: "",
    });
  };

  const discardDraft = () => {
    if (draft) URL.revokeObjectURL(draft.objectUrl);
    setDraft(null);
  };

  const saveDraft = () => {
    if (!draft) return;
    const uuid = crypto.randomUUID();
    const ext = draft.mediaType === "video" ? videoExtension(draft.file) : "jpg";
    const item: PendingItem = {
      id: crypto.randomUUID(),
      storagePath: `${businessId}/${orderId}/${uuid}.${ext}`,
      objectUrl: draft.objectUrl, // Eigentum geht ans Item über → nicht revoken
      file: draft.file,
      mediaType: draft.mediaType,
      durationSeconds: draft.durationSeconds,
      keyword: draft.keyword.trim() || null,
      status: "uploading",
    };
    setItems((prev) => [...prev, item]);
    setDraft(null); // UI sofort frei für die nächste Aufnahme
    void runUpload(item);
  };

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Versteckte Datei-Inputs. Aufnahme: native Kamera (`capture`); Upload:
          Galerie/Dateiauswahl (ohne `capture`). Beide nutzen dieselben Handler. */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={handlePhotoFile}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => void handleVideoFile(e)}
      />
      <input
        ref={photoUploadInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handlePhotoFile}
      />
      <input
        ref={videoUploadInputRef}
        type="file"
        accept="video/*"
        style={{ display: "none" }}
        onChange={(e) => void handleVideoFile(e)}
      />

      {/* Große, klar tappbare Buttons — Zeile „Aufnehmen" (Kamera) + Zeile
          „Hochladen" (Galerie/Datei). Beide Quellen, identische Pipeline. */}
      <div className="capture-actions">
        <div className="capture-row">
          <div
            role="button"
            tabIndex={0}
            className="btn-dark capture-btn"
            onClick={openPhoto}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") openPhoto();
            }}
          >
            <CameraIcon />
            {t(DEFAULT_LOCALE, "capture.photo")}
          </div>
          <div
            role="button"
            tabIndex={0}
            className="btn-outline capture-btn"
            onClick={openVideo}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") openVideo();
            }}
          >
            <VideoIcon />
            {t(DEFAULT_LOCALE, "capture.video")}
          </div>
        </div>
        <div className="capture-row">
          <div
            role="button"
            tabIndex={0}
            className="btn-outline capture-btn"
            onClick={openPhotoUpload}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") openPhotoUpload();
            }}
          >
            <UploadIcon />
            {t(DEFAULT_LOCALE, "capture.uploadPhoto")}
          </div>
          <div
            role="button"
            tabIndex={0}
            className="btn-outline capture-btn"
            onClick={openVideoUpload}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") openVideoUpload();
            }}
          >
            <UploadIcon />
            {t(DEFAULT_LOCALE, "capture.uploadVideo")}
          </div>
        </div>
      </div>

      {/* Hinweis (z. B. Video zu lang) — nur sichtbar, wenn gesetzt. */}
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

      {/* Entwurf: Vorschau + Stichwort + Tag + Speichern/Verwerfen.
          Inline-Card auf Desktop, bildschirmfüllender Dialog auf Mobile
          (`.capture-draft` schaltet per Media Query um). */}
      {draft ? (
        <div
          className="card capture-draft"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {draft.mediaType === "video" ? (
            <video
              src={draft.objectUrl}
              controls
              playsInline
              preload="metadata"
              style={{
                width: "100%",
                maxHeight: 320,
                borderRadius: "var(--radius)",
                background: "var(--surface-2)",
              }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- lokale objectURL-Vorschau, kein Remote-Bild.
            <img
              src={draft.objectUrl}
              alt=""
              style={{
                width: "100%",
                maxHeight: 320,
                objectFit: "contain",
                borderRadius: "var(--radius)",
                background: "var(--surface-2)",
              }}
            />
          )}

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {t(DEFAULT_LOCALE, "capture.keywordOptional")}
            </span>
            <input
              type="text"
              className="form-input"
              value={draft.keyword}
              onChange={(e) =>
                setDraft((prev) =>
                  prev ? { ...prev, keyword: e.target.value } : prev,
                )
              }
            />
          </label>

          <div style={{ display: "flex", gap: 12 }}>
            <div
              role="button"
              tabIndex={0}
              className="btn-dark"
              style={{ flex: 1, padding: "16px", fontSize: 15 }}
              onClick={saveDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") saveDraft();
              }}
            >
              {t(DEFAULT_LOCALE, "capture.save")}
            </div>
            <div
              role="button"
              tabIndex={0}
              className="btn-outline"
              style={{ flex: 1, padding: "16px", fontSize: 15 }}
              onClick={discardDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") discardDraft();
              }}
            >
              {t(DEFAULT_LOCALE, "capture.discard")}
            </div>
          </div>
        </div>
      ) : null}

      {/* Optimistische Items (Queue) — oberhalb der Server-Liste eingereiht. */}
      {items.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            marginTop: 12,
          }}
        >
          {items.map((item) => (
            <PendingRow key={item.id} item={item} onRetry={() => void runUpload(item)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Optimistische Listenzeile: lokales Thumbnail + Status (lädt…/Fehler+Erneut). */
function PendingRow({
  item,
  onRetry,
}: {
  item: PendingItem;
  onRetry: () => void;
}) {
  const isError = item.status === "error";
  return (
    <div
      className="card"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: 12,
        opacity: isError ? 1 : 0.7,
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          flexShrink: 0,
          borderRadius: "var(--radius)",
          overflow: "hidden",
          background: "var(--surface-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {item.mediaType === "video" ? (
          <video
            src={item.objectUrl}
            muted
            playsInline
            preload="metadata"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- lokale objectURL-Vorschau.
          <img
            src={item.objectUrl}
            alt={item.keyword ?? ""}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        {item.keyword ? (
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.keyword}
          </div>
        ) : null}
        <div
          style={{
            marginTop: 2,
            fontSize: 12,
            color: isError ? "#B23B3B" : "var(--text-secondary)",
          }}
        >
          {isError
            ? t(DEFAULT_LOCALE, "capture.uploadError")
            : t(DEFAULT_LOCALE, "capture.uploading")}
        </div>
      </div>

      {isError ? (
        <div
          role="button"
          tabIndex={0}
          className="btn-outline"
          style={{ flexShrink: 0, padding: "8px 14px" }}
          onClick={onRetry}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onRetry();
          }}
        >
          {t(DEFAULT_LOCALE, "capture.retry")}
        </div>
      ) : null}
    </div>
  );
}

/** Schlichtes Inline-SVG-Kamera-Icon für den Aufnahme-Button. Reine Deko. */
function CameraIcon() {
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
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
      <circle cx="12" cy="13.5" r="3.2" />
    </svg>
  );
}

/** Schlichtes Inline-SVG-Upload-Icon für die Hochladen-Buttons. Reine Deko. */
function UploadIcon() {
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
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M5 20h14" />
    </svg>
  );
}

/** Schlichtes Inline-SVG-Video-Icon für den Video-Button. Reine Deko. */
function VideoIcon() {
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
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
    </svg>
  );
}
