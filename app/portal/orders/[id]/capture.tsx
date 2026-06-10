"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/media/compress";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import type { MediaTag } from "@/lib/orders/queries";

/** Browser-Client (anon-Key, RLS) — pro Komponenteninstanz einmal erzeugt. */
type BrowserClient = ReturnType<typeof createClient>;

/** Auswählbare Tags in fester Reihenfolge (vorher → nachher → prozess). */
const TAG_OPTIONS: readonly MediaTag[] = ["vorher", "nachher", "prozess"];

/** Retry-Verhalten des Hintergrund-Uploads (Direktupload in den Storage). */
const UPLOAD_MAX_ATTEMPTS = 3; // 1 Versuch + bis zu 2 Retries
const UPLOAD_BACKOFF_MS = 800; // wächst linear pro Versuch

/** Noch nicht gespeicherte Aufnahme (lokale Vorschau + Eingaben). */
type Draft = {
  file: File;
  objectUrl: string;
  keyword: string;
  tag: MediaTag | null;
};

/** Ein in der In-Memory-Queue laufendes (optimistisches) Upload-Item. */
type PendingItem = {
  id: string; // lokaler Schlüssel für React + Queue-Operationen
  storagePath: string; // {businessId}/{orderId}/{uuid}.jpg (einmalig vergeben)
  objectUrl: string; // lokales Thumbnail (Original-Aufnahme)
  file: File; // Original — bei „Erneut" wird neu komprimiert
  keyword: string | null;
  tag: MediaTag | null;
  status: "uploading" | "error";
};

/** Pause (ms) — kurzer Backoff zwischen Upload-Versuchen. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < UPLOAD_MAX_ATTEMPTS; attempt++) {
    const { error } = await supabase.storage
      .from("order-media")
      .upload(path, blob, { contentType: "image/jpeg", upsert: true });
    if (!error) return;
    lastError = error;
    if (attempt < UPLOAD_MAX_ATTEMPTS - 1) {
      await delay(UPLOAD_BACKOFF_MS * (attempt + 1));
    }
  }
  throw lastError ?? new Error("upload_failed");
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
}: {
  businessId: string;
  orderId: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [items, setItems] = useState<PendingItem[]>([]);

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
      try {
        const compressed = await compressImage(item.file);
        await uploadWithRetry(supabase, item.storagePath, compressed.blob);

        const res = await fetch(`/api/portal/orders/${orderId}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storage_path: item.storagePath,
            media_type: "photo",
            keyword: item.keyword,
            tag: item.tag,
            width: compressed.width,
            height: compressed.height,
          }),
        });
        if (!res.ok) throw new Error("metadata_failed");

        // Erfolg: optimistisches Item entfernen, Server-Liste neu laden.
        setItems((prev) => {
          const done = prev.find((it) => it.id === item.id);
          if (done) URL.revokeObjectURL(done.objectUrl);
          return prev.filter((it) => it.id !== item.id);
        });
        router.refresh();
      } catch {
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id ? { ...it, status: "error" } : it,
          ),
        );
      }
    },
    [supabase, orderId, router],
  );

  const openCamera = () => fileInputRef.current?.click();

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // erlaubt erneute Auswahl derselben Datei
    if (!file) return;
    if (draft) URL.revokeObjectURL(draft.objectUrl); // vorigen Entwurf verwerfen
    setDraft({
      file,
      objectUrl: URL.createObjectURL(file),
      keyword: "",
      tag: null,
    });
  };

  const discardDraft = () => {
    if (draft) URL.revokeObjectURL(draft.objectUrl);
    setDraft(null);
  };

  const saveDraft = () => {
    if (!draft) return;
    const uuid = crypto.randomUUID();
    const item: PendingItem = {
      id: crypto.randomUUID(),
      storagePath: `${businessId}/${orderId}/${uuid}.jpg`,
      objectUrl: draft.objectUrl, // Eigentum geht ans Item über → nicht revoken
      file: draft.file,
      keyword: draft.keyword.trim() || null,
      tag: draft.tag,
      status: "uploading",
    };
    setItems((prev) => [...prev, item]);
    setDraft(null); // UI sofort frei für die nächste Aufnahme
    void runUpload(item);
  };

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Verstecktes Datei-Input — native Kamera (Rückseite), nur Bilder. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={handleFile}
      />

      {/* Großer, klar tappbarer Aufnahme-Button. */}
      <div
        role="button"
        tabIndex={0}
        className="btn-dark"
        style={{ width: "100%", padding: "16px", fontSize: 16, gap: 10 }}
        onClick={openCamera}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") openCamera();
        }}
      >
        <CameraIcon />
        {t(DEFAULT_LOCALE, "capture.photo")}
      </div>

      {/* Entwurf: Vorschau + Stichwort + Tag + Speichern/Verwerfen. */}
      {draft ? (
        <div
          className="card"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            marginTop: 12,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- lokale objectURL-Vorschau, kein Remote-Bild. */}
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

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {t(DEFAULT_LOCALE, "capture.tagOptional")}
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {TAG_OPTIONS.map((tag) => {
                const active = draft.tag === tag;
                return (
                  <div
                    key={tag}
                    role="button"
                    tabIndex={0}
                    aria-pressed={active}
                    className={active ? "btn-dark" : "btn-outline"}
                    style={{ flex: 1, minWidth: 96, padding: "10px 12px" }}
                    onClick={() =>
                      setDraft((prev) =>
                        prev
                          ? { ...prev, tag: prev.tag === tag ? null : tag }
                          : prev,
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        setDraft((prev) =>
                          prev
                            ? { ...prev, tag: prev.tag === tag ? null : tag }
                            : prev,
                        );
                      }
                    }}
                  >
                    {t(DEFAULT_LOCALE, `mediaTag.${tag}`)}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <div
              role="button"
              tabIndex={0}
              className="btn-dark"
              style={{ flex: 1, padding: "14px" }}
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
              style={{ flex: 1, padding: "14px" }}
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
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- lokale objectURL-Vorschau. */}
        <img
          src={item.objectUrl}
          alt={item.keyword ?? ""}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
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
            ? t(DEFAULT_LOCALE, "capture.error")
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
