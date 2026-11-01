export interface Track {
  number: number;
  first_sector: number;
  last_sector: number;
  is_audio: boolean;
}

export interface Toc {
  tracks: Track[];
  leadout_sector: number;
}

export const SECTORS_PER_SECOND = 75;
/** Largest chunk the `cd-track` protocol serves (5 s). Mirrors `MAX_CHUNK_SECTORS` in Rust. */
export const MAX_CHUNK_SECTORS = 375;
