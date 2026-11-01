import { describe, expect, it, vi } from "vitest";
import type { Toc } from "$lib/disc/types";
import { computeDiscId } from "./discId";
import { artistCreditText, lookupDiscMetadata, parseDiscLookup, pickCoverUrl, type MetadataStorage } from "./musicBrainz";

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

const memoryStorage = (): MetadataStorage & { values: Map<string, string> } => {
  const values = new Map<string, string>();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) };
};

/** A fake `fetch` that answers by URL prefix. */
const fakeFetch = (routes: Record<string, () => Response | Promise<Response>>) =>
  vi.fn(async (url: string | URL | Request) => {
    const match = Object.keys(routes).find((prefix) => String(url).startsWith(prefix));
    if (!match) throw new Error(`unexpected request: ${url}`);
    return routes[match]();
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const coverIndex = { images: [{ front: false, image: "https://x/back.jpg" }, { front: true, image: "https://x/front.jpg", thumbnails: { "250": "http://x/front-250.jpg" } }] };

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

describe("pickCoverUrl", () => {
  it("prefers the front image's 250 px thumbnail, over https", () => {
    expect(pickCoverUrl(coverIndex)).toBe("https://x/front-250.jpg");
  });

  it("falls back to the full image, and is null with no images", () => {
    expect(pickCoverUrl({ images: [{ front: true, image: "http://x/full.jpg" }] })).toBe("https://x/full.jpg");
    expect(pickCoverUrl({ images: [] })).toBeNull();
  });
});

describe("lookupDiscMetadata", () => {
  it("finds the disc by its ID, takes the first release and adds the cover", async () => {
    const discId = (await computeDiscId(toc))!;
    const fetcher = fakeFetch({
      [`https://musicbrainz.org/ws/2/discid/${discId}?`]: () => json({ releases: [release(discId)] }),
      "https://coverartarchive.org/release/release-1": () => json(coverIndex),
    });

    const metadata = await lookupDiscMetadata(toc, { fetcher, storage: null });

    expect(metadata).toMatchObject({ discId, album: "First Album", coverUrl: "https://x/front-250.jpg" });
    expect(metadata.tracks.map(({ title }) => title)).toEqual(["One", "Two"]);
  });

  it("still succeeds when the release has no cover or the cover service fails", async () => {
    const discId = (await computeDiscId(toc))!;
    const musicBrainz = { [`https://musicbrainz.org/ws/2/discid/${discId}?`]: () => json({ releases: [release(discId)] }) };

    const noCover = fakeFetch({ ...musicBrainz, "https://coverartarchive.org": () => new Response("", { status: 404 }) });
    expect((await lookupDiscMetadata(toc, { fetcher: noCover, storage: null })).coverUrl).toBeNull();

    const broken = fakeFetch({ ...musicBrainz, "https://coverartarchive.org": () => Promise.reject(new Error("offline")) });
    expect((await lookupDiscMetadata(toc, { fetcher: broken, storage: null })).coverUrl).toBeNull();
  });

  it("caches a found disc, so it is only looked up once", async () => {
    const discId = (await computeDiscId(toc))!;
    const storage = memoryStorage();
    const fetcher = fakeFetch({
      "https://musicbrainz.org": () => json({ releases: [release(discId)] }),
      "https://coverartarchive.org": () => json(coverIndex),
    });

    await lookupDiscMetadata(toc, { fetcher, storage });
    const again = await lookupDiscMetadata(toc, { fetcher, storage });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(again.album).toBe("First Album");
  });

  it("says so when the disc is not on MusicBrainz, and doesn't cache that", async () => {
    const storage = memoryStorage();
    const fetcher = fakeFetch({ "https://musicbrainz.org": () => new Response("", { status: 404 }) });

    await expect(lookupDiscMetadata(toc, { fetcher, storage })).rejects.toThrow("not on MusicBrainz");
    expect(storage.values.size).toBe(0);
  });

  it("explains a busy MusicBrainz, other errors, and a network failure", async () => {
    const busy = fakeFetch({ "https://musicbrainz.org": () => new Response("", { status: 503 }) });
    await expect(lookupDiscMetadata(toc, { fetcher: busy, storage: null })).rejects.toThrow("busy");

    const broken = fakeFetch({ "https://musicbrainz.org": () => new Response("", { status: 500 }) });
    await expect(lookupDiscMetadata(toc, { fetcher: broken, storage: null })).rejects.toThrow("answered 500");

    const offline = fakeFetch({ "https://musicbrainz.org": () => Promise.reject(new Error("offline")) });
    await expect(lookupDiscMetadata(toc, { fetcher: offline, storage: null })).rejects.toThrow("could not be reached: offline");
  });

  it("fails without a request when the disc has no audio", async () => {
    const fetcher = fakeFetch({});
    const dataOnly: Toc = { tracks: [{ number: 1, first_sector: 0, last_sector: 9, is_audio: false }], leadout_sector: 10 };

    await expect(lookupDiscMetadata(dataOnly, { fetcher, storage: null })).rejects.toThrow("no audio");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("carries on when storage throws", async () => {
    const discId = (await computeDiscId(toc))!;
    const storage: MetadataStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    const fetcher = fakeFetch({
      "https://musicbrainz.org": () => json({ releases: [release(discId)] }),
      "https://coverartarchive.org": () => json(coverIndex),
    });

    expect((await lookupDiscMetadata(toc, { fetcher, storage })).album).toBe("First Album");
  });
});
