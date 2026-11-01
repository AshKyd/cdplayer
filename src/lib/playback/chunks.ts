import { MAX_CHUNK_SECTORS, SECTORS_PER_SECOND, type Track } from "$lib/disc/types";

/** First chunk is 1 s so playback starts quickly; later chunks are full size. */
const FIRST_CHUNK_SECTORS = SECTORS_PER_SECOND;

export const trackSectorCount = ({ first_sector, last_sector }: Track) => last_sector - first_sector + 1;

/** Track-relative sector to start from, clamped to the track. */
export const startSectorForTime = (track: Track, timeSeconds: number) =>
  Math.min(Math.max(0, Math.floor(timeSeconds * SECTORS_PER_SECOND)), trackSectorCount(track) - 1);

/** Size of the next request: short for the first chunk, full after, never past the track end. */
export const nextChunkSectorCount = (track: Track, cursorSector: number, isFirstChunk: boolean) =>
  Math.min(isFirstChunk ? FIRST_CHUNK_SECTORS : MAX_CHUNK_SECTORS, trackSectorCount(track) - cursorSector);

export const chunkUrl = (trackNumber: number, startSector: number, sectorCount: number) =>
  `cd-track://localhost/track/${trackNumber}?start=${startSector}&count=${sectorCount}`;
