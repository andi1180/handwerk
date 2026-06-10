/**
 * Caption-Grenzwerte ohne SDK-Import → sowohl im Client (media-list) als auch
 * server-seitig importierbar, ohne den Anthropic-SDK in das Client-Bundle zu ziehen.
 */

/** Längen-Limit für Captions (serverseitig erzwungen, im Client zur Begrenzung). */
export const CAPTION_MAX_LENGTH = 180;
