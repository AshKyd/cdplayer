import { describe, expect, it, vi } from "vitest";
import type { KeyValueCache } from "$lib/cache/keyValueCache";
import type { Toc } from "$lib/disc/types";
import { computeDiscId } from "./discId";
import { artistCreditText, lookupDiscMetadata, parseDiscLookup, pickCover } from "./musicBrainz";

const toc: Toc = {
  tracks: [
    { number: 1, first_sector: 0, last_sector: 14_999, is_audio: true },
    { number: 2, first_sector: 15_000, last_sector: 29_999, is_audio: true },
  ],
  leadout_sector: 30_000,
};

const band = [{ name: "The Band", joinphrase: "", artist: { name: "The Band" } }];

const release = (discId: string) => ({
  id: "release-1",
  title: "First Album",
  date: "1997-05-21",
  "artist-credit": band,
  media: [
    {
      discs: [{ id: discId }],
      tracks: [
        { position: 1, title: "One", "artist-credit": band },
        { position: 2, title: "Two", "artist-credit": [{ name: "Guest", joinphrase: "" }] },
      ],
    },
  ],
});

const memoryCache = (): KeyValueCache & { values: Map<string, unknown> } => {
  const values = new Map<string, unknown>();
  return {
    values,
    get: async <T>(key: string) => values.get(key) as T | undefined,
    set: async (key, value) => void values.set(key, value),
    delete: async (key) => void values.delete(key),
  };
};

/** A fake `fetch` that answers by URL prefix. */
const fakeFetch = (routes: Record<string, () => Response | Promise<Response>>) =>
  vi.fn(async (url: string | URL | Request) => {
    const match = Object.keys(routes).find((prefix) => String(url).startsWith(prefix));
    if (!match) throw new Error(`unexpected request: ${url}`);
    return routes[match]();
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const image = () => new Response(new Blob(["pixels"], { type: "image/jpeg" }));

const coverIndex = {
  images: [
    { front: false, image: "https://x/back.jpg" },
    { front: true, image: "https://x/front.jpg", thumbnails: { "250": "http://x/front-250.jpg", "1200": "http://x/front-1200.jpg" } },
  ],
};

/** An index whose front image has no original, only thumbnails. */
const thumbnailOnlyIndex = { images: [{ front: true, thumbnails: { "250": "https://x/t-250.jpg", "500": "https://x/t-500.jpg" } }] };

const routesFor = (discId: string, cover: Record<string, () => Response | Promise<Response>>) => ({
  [`https://musicbrainz.org/ws/2/discid/${discId}?`]: () => json({ releases: [release(discId)] }),
  ...cover,
});

describe("artistCreditText", () => {
  it("joins the names with their join phrases", () => {
    expect(artistCreditText([{ name: "A", joinphrase: " feat. " }, { name: "B" }])).toBe("A feat. B");
  });

  it("falls back to the artist's own name, and is empty for no credit", () => {
    expect(artistCreditText([{ artist: { name: "C" } }])).toBe("C");
    expect(artistCreditText(undefined)).toBe("");
  });
});

describe("parseDiscLookup", () => {
  it("reads the album, artist, year and tracks of the first release", () => {
    const parsed = parseDiscLookup({ releases: [release("abc"), { ...release("abc"), id: "release-2" }] }, "abc")!;
    expect(parsed).toMatchObject({ releaseId: "release-1", album: "First Album", artist: "The Band", year: "1997" });
    expect(parsed.tracks).toEqual([
      { number: 1, title: "One", artist: "The Band" },
      { number: 2, title: "Two", artist: "Guest" },
    ]);
  });

  it("picks the medium that has the disc ID in a multi-disc release", () => {
    const multi = {
      ...release("disc-two"),
      media: [
        { discs: [{ id: "disc-one" }], tracks: [{ position: 1, title: "On disc one" }] },
        { discs: [{ id: "disc-two" }], tracks: [{ position: 1, title: "On disc two" }] },
      ],
    };
    expect(parseDiscLookup({ releases: [multi] }, "disc-two")!.tracks[0].title).toBe("On disc two");
  });

  it("is null when there is no release", () => {
    expect(parseDiscLookup({ releases: [] }, "abc")).toBeNull();
    expect(parseDiscLookup({}, "abc")).toBeNull();
  });
});

describe("pickCover", () => {
  it("prefers the front image's original, over https", () => {
    expect(pickCover(coverIndex)).toEqual({ url: "https://x/front.jpg", isOriginal: true });
    expect(pickCover({ images: [{ front: true, image: "http://x/full.jpg" }] })?.url).toBe("https://x/full.jpg");
  });

  it("falls back to the largest thumbnail when there is no original", () => {
    expect(pickCover(thumbnailOnlyIndex)).toEqual({ url: "https://x/t-500.jpg", isOriginal: false });
  });

  it("is null with no usable images", () => {
    expect(pickCover({ images: [] })).toBeNull();
    expect(pickCover({ images: [{ front: true }] })).toBeNull();
  });
});

describe("lookupDiscMetadata", () => {
  it("finds the disc by its ID, takes the first release and adds the original cover", async () => {
    const discId = (await computeDiscId(toc))!;
    const fetcher = fakeFetch(routesFor(discId, { "https://coverartarchive.org/release/release-1": () => json(coverIndex), "https://x/front.jpg": image }));

    const metadata = await lookupDiscMetadata(toc, { fetcher, cache: null });

    expect(metadata).toMatchObject({ discId, album: "First Album" });
    expect(metadata.coverUrl).toMatch(/^blob:/);
    expect(metadata.tracks.map(({ title }) => title)).toEqual(["One", "Two"]);
    expect(fetcher).toHaveBeenCalledWith("https://x/front.jpg", expect.anything());
  });

  it("still succeeds when the release has no cover or the cover service fails", async () => {
    const discId = (await computeDiscId(toc))!;

    const noCover = fakeFetch(routesFor(discId, { "https://coverartarchive.org": () => new Response("", { status: 404 }) }));
    expect((await lookupDiscMetadata(toc, { fetcher: noCover, cache: null })).coverUrl).toBeNull();

    const broken = fakeFetch(routesFor(discId, { "https://coverartarchive.org": () => Promise.reject(new Error("offline")) }));
    expect((await lookupDiscMetadata(toc, { fetcher: broken, cache: null })).coverUrl).toBeNull();
  });

  it("uses the remote URL when the image can't be downloaded, and caches no cover", async () => {
    const discId = (await computeDiscId(toc))!;
    const cache = memoryCache();
    const fetcher = fakeFetch(routesFor(discId, { "https://coverartarchive.org": () => json(coverIndex), "https://x/front.jpg": () => Promise.reject(new Error("cors")) }));

    const metadata = await lookupDiscMetadata(toc, { fetcher, cache });

    expect(metadata.coverUrl).toBe("https://x/front.jpg");
    expect([...cache.values.keys()]).toEqual([expect.stringContaining("musicbrainz.disc.")]);
  });

  it("caches the metadata and cover, so a disc is only looked up once", async () => {
    const discId = (await computeDiscId(toc))!;
    const cache = memoryCache();
    const fetcher = fakeFetch(routesFor(discId, { "https://coverartarchive.org/release/release-1": () => json(coverIndex), "https://x/front.jpg": image }));

    await lookupDiscMetadata(toc, { fetcher, cache });
    const again = await lookupDiscMetadata(toc, { fetcher, cache });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(again.album).toBe("First Album");
    expect(again.coverUrl).toMatch(/^blob:/);
    expect(cache.values.size).toBe(2);
  });

  it("replaces a cached thumbnail with the original once it is available", async () => {
    const discId = (await computeDiscId(toc))!;
    const cache = memoryCache();
    const thumbnailFetcher = fakeFetch(routesFor(discId, { "https://coverartarchive.org": () => json(thumbnailOnlyIndex), "https://x/t-500.jpg": image }));
    await lookupDiscMetadata(toc, { fetcher: thumbnailFetcher, cache });
    expect(cache.values.get("coverart.release.release-1")).toMatchObject({ isOriginal: false });

    const originalFetcher = fakeFetch({ "https://coverartarchive.org": () => json(coverIndex), "https://x/front.jpg": image });
    await lookupDiscMetadata(toc, { fetcher: originalFetcher, cache });

    expect(cache.values.get("coverart.release.release-1")).toMatchObject({ isOriginal: true, sourceUrl: "https://x/front.jpg" });
  });

  it("keeps a cached thumbnail when the archive is unreachable", async () => {
    const discId = (await computeDiscId(toc))!;
    const cache = memoryCache();
    const thumbnailFetcher = fakeFetch(routesFor(discId, { "https://coverartarchive.org": () => json(thumbnailOnlyIndex), "https://x/t-500.jpg": image }));
    await lookupDiscMetadata(toc, { fetcher: thumbnailFetcher, cache });

    const offline = fakeFetch({ "https://coverartarchive.org": () => Promise.reject(new Error("offline")) });

    expect((await lookupDiscMetadata(toc, { fetcher: offline, cache })).coverUrl).toMatch(/^blob:/);
  });

  it("says so when the disc is not on MusicBrainz, and doesn't cache that", async () => {
    const cache = memoryCache();
    const fetcher = fakeFetch({ "https://musicbrainz.org": () => new Response("", { status: 404 }) });

    await expect(lookupDiscMetadata(toc, { fetcher, cache })).rejects.toThrow("not on MusicBrainz");
    expect(cache.values.size).toBe(0);
  });

  it("explains a busy MusicBrainz, other errors, and a network failure", async () => {
    const busy = fakeFetch({ "https://musicbrainz.org": () => new Response("", { status: 503 }) });
    await expect(lookupDiscMetadata(toc, { fetcher: busy, cache: null })).rejects.toThrow("busy");

    const broken = fakeFetch({ "https://musicbrainz.org": () => new Response("", { status: 500 }) });
    await expect(lookupDiscMetadata(toc, { fetcher: broken, cache: null })).rejects.toThrow("answered 500");

    const offline = fakeFetch({ "https://musicbrainz.org": () => Promise.reject(new Error("offline")) });
    await expect(lookupDiscMetadata(toc, { fetcher: offline, cache: null })).rejects.toThrow("could not be reached: offline");
  });

  it("fails without a request when the disc has no audio", async () => {
    const fetcher = fakeFetch({});
    const dataOnly: Toc = { tracks: [{ number: 1, first_sector: 0, last_sector: 9, is_audio: false }], leadout_sector: 10 };

    await expect(lookupDiscMetadata(dataOnly, { fetcher, cache: null })).rejects.toThrow("no audio");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("carries on when the cache throws", async () => {
    const discId = (await computeDiscId(toc))!;
    const cache: KeyValueCache = {
      get: () => Promise.reject(new Error("blocked")),
      set: () => Promise.reject(new Error("full")),
      delete: () => Promise.reject(new Error("blocked")),
    };
    const fetcher = fakeFetch(routesFor(discId, { "https://coverartarchive.org": () => json(coverIndex), "https://x/front.jpg": image }));

    expect((await lookupDiscMetadata(toc, { fetcher, cache })).album).toBe("First Album");
  });
});
