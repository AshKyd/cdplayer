import { defaultKeyValueCache, type KeyValueCache } from "$lib/cache/keyValueCache";
import type { Toc } from "$lib/disc/types";
import { computeDiscId } from "./discId";
import type { DiscMetadata } from "./types";

const MUSICBRAINZ_URL = "https://musicbrainz.org/ws/2/discid";
const COVER_ART_URL = "https://coverartarchive.org/release";

/** MusicBrainz and the Cover Art Archive can be slow; a disc is playable without them, so don't wait long. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Original cover images can be several MB, so they get longer. */
const IMAGE_TIMEOUT_MS = 30_000;

const METADATA_KEY_PREFIX = "musicbrainz.disc.";
const COVER_KEY_PREFIX = "coverart.release.";

interface Options {
  /** Tests pass a fake. */
  fetcher?: typeof fetch;
  /** Where looked-up discs and covers are kept. Defaults to the Dexie cache; `null` turns caching off. */
  cache?: KeyValueCache | null;
}

/** A cover image as kept in the cache. */
interface CachedCover {
  blob: Blob;
  sourceUrl: string;
  /** False when only a thumbnail was available, so a later lookup tries for the original again. */
  isOriginal: boolean;
}

interface PickedCover {
  url: string;
  isOriginal: boolean;
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

/** Largest thumbnail first, for when a front image has no original. */
const THUMBNAIL_SIZES_LARGEST_FIRST = ["1200", "large", "500", "small", "250"];

/**
 * The front cover from a Cover Art Archive index at the highest quality on offer: the original upload,
 * else the largest thumbnail. `null` if there are no images.
 */
export const pickCover = (index: CoverArtIndex): PickedCover | null => {
  const front = index.images?.find(({ front }) => front) ?? index.images?.[0];
  if (!front) return null;

  const thumbnail = THUMBNAIL_SIZES_LARGEST_FIRST.map((size) => front.thumbnails?.[size]).find(Boolean);
  const url = front.image ?? thumbnail;
  if (!url) return null;

  // Older entries are plain http, which a secure page may not load.
  return { url: url.replace(/^http:/, "https:"), isOriginal: Boolean(front.image) };
};

/** Cache failures (missing, blocked or full) are swallowed: the lookup just happens again next time. */
const readCache = <T>(cache: KeyValueCache | null, key: string): Promise<T | undefined> =>
  cache ? cache.get<T>(key).catch(() => undefined) : Promise.resolve(undefined);

const writeCache = (cache: KeyValueCache | null, key: string, value: unknown): Promise<void> =>
  cache ? cache.set(key, value).catch(() => undefined) : Promise.resolve();

/** One string per line so the details can be copied out of the console. */
const log = (details: Record<string, unknown>): void => console.log(`[musicbrainz] ${JSON.stringify(details)}`);

const getJson = async <T>(fetcher: typeof fetch, url: string): Promise<{ status: number; json: T | null }> => {
  log({ fetching: url });
  const response = await fetcher(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  log({ fetched: url, status: response.status, finalUrl: response.url, redirected: response.redirected });
  return { status: response.status, json: response.ok ? ((await response.json()) as T) : null };
};

const getBlob = async (fetcher: typeof fetch, url: string): Promise<Blob> => {
  log({ fetching: url });
  const response = await fetcher(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) });
  log({ fetched: url, status: response.status, finalUrl: response.url });
  if (!response.ok) throw new Error(`answered ${response.status}`);
  return response.blob();
};

const errorText = (reason: unknown): string => (reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason));

/**
 * A URL for the front cover of a release at the highest quality available, or `null`. Never throws: a
 * missing cover isn't worth failing the lookup.
 *
 * The image itself is kept in the cache, as a blob. A cover cached from a thumbnail is replaced once the
 * original can be fetched. If the image can't be downloaded (say the archive blocks cross-origin reads),
 * the remote URL is used directly, as before, and nothing is cached.
 */
const resolveCoverUrl = async (fetcher: typeof fetch, cache: KeyValueCache | null, releaseId: string): Promise<string | null> => {
  const cacheKey = COVER_KEY_PREFIX + releaseId;
  const cached = await readCache<CachedCover>(cache, cacheKey);
  if (cached?.isOriginal) return URL.createObjectURL(cached.blob);

  // From here the best we have is a thumbnail or nothing, so look for something better.
  const picked = await getJson<CoverArtIndex>(fetcher, `${COVER_ART_URL}/${releaseId}`)
    .then(({ json }) => {
      const cover = json ? pickCover(json) : null;
      log({ releaseId, imageCount: json?.images?.length ?? 0, coverUrl: cover?.url ?? null, isOriginal: cover?.isOriginal ?? false });
      return cover;
    })
    .catch((reason) => {
      log({ releaseId, coverError: errorText(reason) });
      return null;
    });

  const fallbackUrl = cached ? URL.createObjectURL(cached.blob) : null;
  if (!picked) return fallbackUrl;

  const blob = await getBlob(fetcher, picked.url).catch((reason) => {
    log({ releaseId, imageError: errorText(reason) });
    return null;
  });
  if (!blob) return fallbackUrl ?? picked.url;

  await writeCache(cache, cacheKey, { blob, sourceUrl: picked.url, isOriginal: picked.isOriginal } satisfies CachedCover);
  return URL.createObjectURL(blob);
};

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
export const lookupDiscMetadata = async (toc: Toc, { fetcher = fetch, cache = defaultKeyValueCache() }: Options = {}): Promise<DiscMetadata> => {
  const discId = await computeDiscId(toc);
  if (!discId) throw new Error("the disc has no audio tracks");

  // The cached metadata never holds a cover URL (a blob URL dies with the page); the cover is resolved each time.
  const cached = await readCache<DiscMetadata>(cache, METADATA_KEY_PREFIX + discId);
  if (cached) {
    log({ cacheHit: discId, releaseId: cached.releaseId });
    return { ...cached, coverUrl: await resolveCoverUrl(fetcher, cache, cached.releaseId) };
  }

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

  await writeCache(cache, METADATA_KEY_PREFIX + discId, metadata);
  return { ...metadata, coverUrl: await resolveCoverUrl(fetcher, cache, metadata.releaseId) };
};
