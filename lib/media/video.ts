/**
 * Liest die Dauer eines Videos **im Browser** über ein verstecktes
 * `<video>`-Element: Sobald die Metadaten geladen sind (`loadedmetadata`),
 * steht `duration` (in Sekunden) bereit. Die Object-URL wird in jedem Fall
 * wieder freigegeben. Kein clientseitiges Dekodieren des gesamten Clips.
 */
export function getVideoDuration(file: File): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute("src");
    };

    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanup();
      if (Number.isFinite(duration)) resolve(duration);
      else reject(new Error("video_duration_unavailable"));
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("video_metadata_failed"));
    };

    video.src = objectUrl;
  });
}
