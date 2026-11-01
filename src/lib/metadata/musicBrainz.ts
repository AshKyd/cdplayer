import type { Toc } from "$lib/disc/types";
import { computeDiscId } from "./discId";
import type { DiscMetadata } from "./types";

const MUSICBRAINZ_URL = "https://musicbrainz.org/ws/2/discid";
const COVER_ART_URL = "https://coverartarchive.org/release";

/** MusicBrainz and the Cover Art Archive can be slow; a disc is playable without them, so don't wait long. */
const REQUEST_TIMEOUT_MS = 10_000;

const CACHE_KEY_PREFIX = "cdplayer.musicbrainz.";

/** Where looked-up discs are kept, so a disc is only looked up once. `localStorage` fits. */
export interface MetadataStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface Options {
  /** Tests pass a fake. */
  fetcher?: typeof fetch;
  /** Defaults to `localStorage` when there is one. */
  storage?: MetadataStorage | null;
}

interface ArtistCredit {
  name?: string;
  joinphrase?: string;
  artist?: { name?: string };
}

/** The parts of a MusicBrainz release that we read. */
interface MusicBrainzRelease {
  id: string;
  title?: string;
  date?: string;
  "artist-credit"?: ArtistCredit[];
  media?: Array<{
    discs?: Array<{ id: string }>;
    tracks?: Array<{ position: number; title?: string; "artist-credit"?: ArtistCredit[] }>;
  }>;
}

interface CoverArtIndex {
  images?: Array<{ front?: boolean; image?: string; thumbnails?: Record<string, string> }>;
}

/** "Artist A feat. Artist B": the credit's names joined by their join phrases. */
export const artistCreditText = (credit: ArtistCredit[] | undefined): string =>
  (credit ?? []).map(({ name, artist, joinphrase }) => `${name ?? artist?.name ?? ""}${joinphrase ?? ""}`).join("").trim();

/**
 * The first release of a disc ID lookup, as `DiscMetadata` without a cover. For a release with several
 * discs, the medium that has this disc ID; failing that, the first. `null` if there is no release.
 */
export const parseDiscLookup = (json: { releases?: MusicBrainzRelease[] }, discId: string): DiscMetadata | null => {
  const [release] = json.releases ?? [];
  if (!release) return null;

  const medium = release.media?.find(({ discs }) => discs?.some(({ id }) => id === discId)) ?? release.media?.[0];
  const albumArtist = artistCreditText(release["artist-credit"]);

  return {
    discId,
    releaseId: release.id,
    album: release.title ?? "",
    artist: albumArtist,
    year: release.date?.slice(0, 4) ?? "",
    tracks: (medium?.tracks ?? []).map(({ position, title, "artist-credit": credit }) => ({
      number: position,
      title: title ?? "",
      artist: artistCreditText(credit) || albumArtist,
    })),
    coverUrl: null,
  };
};

/** A front cover thumbnail from a Cover Art Archive index, preferring about 250 px. `null` if there isn't one. */
export const pickCoverUrl = (index: CoverArtIndex): string | null => {
  const front = index.images?.find(({ front }) => front) ?? index.images?.[0];
  const url = front?.thumbnails?.["250"] ?? front?.thumbnails?.small ?? front?.image;
  // Older entries are plain http, which a secure page may not load.
  return url ? url.replace(/^http:/, "https:") : null;
};

const defaultStorage = (): MetadataStorage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const readCache = (storage: MetadataStorage | null, discId: string): DiscMetadata | null => {
  try {
    const stored = storage?.getItem(CACHE_KEY_PREFIX + discId);
    return stored ? (JSON.parse(stored) as DiscMetadata) : null;
  } catch {
    return null;
  }
};

const writeCache = (storage: MetadataStorage | null, metadata: DiscMetadata): void => {
  try {
    storage?.setItem(CACHE_KEY_PREFIX + metadata.discId, JSON.stringify(metadata));
  } catch {
    // Storage can be full or blocked; the lookup just happens again next time.
  }
};

const getJson = async <T>(fetcher: typeof fetch, url: string): Promise<{ status: number; json: T | null }> => {
  const response = await fetcher(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { status: response.status, json: response.ok ? ((await response.json()) as T) : null };
};

/** The front cover of a release, or `null`. Never throws: a missing cover isn't worth failing the lookup. */
const fetchCoverUrl = async (fetcher: typeof fetch, releaseId: string): Promise<string | null> =>
  getJson<CoverArtIndex>(fetcher, `${COVER_ART_URL}/${releaseId}`)
    .then(({ json }) => (json ? pickCoverUrl(json) : null))
    .catch(() => null);

/**
 * Looks a disc up on MusicBrainz by its disc ID and takes the first matching release, with its front
 * cover from the Cover Art Archive. Results are cached by disc ID.
 *
 * No account or key is needed. MusicBrainz asks for a User-Agent naming the app, which a webview's
 * `fetch` can't set, so for now this goes out with the webview's own.
 *
 * Throws an `Error` with a readable message if the disc has no audio, is not on MusicBrainz, or the
 * request fails.
 */
export const lookupDiscMetadata = async (toc: Toc, { fetcher = fetch, storage = defaultStorage() }: Options = {}): Promise<DiscMetadata> => {
  const discId = await computeDiscId(toc);
  if (!discId) throw new Error("the disc has no audio tracks");

  const cached = readCache(storage, discId);
  if (cached) return cached;

  const { status, json } = await getJson<{ releases?: MusicBrainzRelease[] }>(
    fetcher,
    `${MUSICBRAINZ_URL}/${discId}?inc=recordings+artist-credits&fmt=json`,
  ).catch((reason) => {
    throw new Error(`MusicBrainz could not be reached: ${reason instanceof Error ? reason.message : reason}`);
  });
  if (status === 404) throw new Error("this disc is not on MusicBrainz");
  if (!json) throw new Error(status === 503 ? "MusicBrainz is busy, try again shortly" : `MusicBrainz answered ${status}`);

  const metadata = parseDiscLookup(json, discId);
  if (!metadata) throw new Error("this disc is not on MusicBrainz");

  const result = { ...metadata, coverUrl: await fetchCoverUrl(fetcher, metadata.releaseId) };
  writeCache(storage, result);
  return result;
};
