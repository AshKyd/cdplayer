# MusicBrainz metadata

Looks a disc up on MusicBrainz to get the album, artist, track names and cover. All in JS; Rust is not involved. `CDPlayer` runs the lookup when a disc is found (state `loadingMetadata`, see [player-lifecycle.md](player-lifecycle.md)).

No account or API key is needed. MusicBrainz asks for a `User-Agent` naming the app, and a webview's `fetch` can't set one, so requests go out with the webview's own for now. The service allows about one request per second; a lookup is one MusicBrainz request plus one Cover Art Archive request.

## Files

- `src/lib/metadata/discId.ts`: `discIdInput(toc)` and `computeDiscId(toc)`.
- `src/lib/metadata/musicBrainz.ts`: `lookupDiscMetadata(toc)` and its parsing helpers.
- `src/lib/metadata/types.ts`: `DiscMetadata` and `TrackMetadata`.
- `src/lib/cache/keyValueCache.ts`: the Dexie key/value cache.

## Disc ID

- The ID is computed from the TOC with `crypto.subtle`: the SHA-1 of the first and last track numbers (2 hex digits each) and 100 offsets (8 hex digits each: the lead-out, then tracks 1 to 99, 0 for a missing track), in uppercase hex. The digest is base64 with `+`, `/` and `=` replaced by `.`, `_` and `-`, so it is always 28 characters.
- An offset is the sector number plus 150.
- Only audio tracks are used. The lead-out is the end of the last audio track plus 150. On a CD-Extra disc the TOC already ends the last audio track 11,400 sectors before the data track, which is the lead-out MusicBrainz expects.
- Tests check two published examples (the MusicBrainz documentation's six-track disc and python-discid's fifteen-track disc), so the whole calculation is known to be right for a TOC in MusicBrainz's units.
- Not yet checked on a real disc: that the sector numbers from `cd-da-reader` are LBAs without the 150-frame lead-in (so that adding 150 gives MusicBrainz's offsets). A real disc's ID should be looked up on musicbrainz.org to confirm.

## Lookup

- `GET https://musicbrainz.org/ws/2/discid/{id}?inc=recordings+artist-credits&fmt=json`.
- The first release in the answer is used. For a release with several discs, the medium that lists this disc ID; otherwise the first.
- The album, artist (the credit's names with their join phrases), year and each track's title and artist are read from it. Track numbers match the disc's track numbers.
- The cover comes from `https://coverartarchive.org/release/{release id}`: the front image's original upload (the highest quality), over https. If there is no original, the largest thumbnail (1200, large, 500, small, 250). A release with no cover, or a failed request, gives `coverUrl: null` and does not fail the lookup.
- The image is downloaded and `coverUrl` is a `blob:` URL of the cached copy. If the download fails (for example the archive blocks cross-origin reads), `coverUrl` is the remote URL and nothing is cached.
- Metadata requests time out after 10 s; image downloads after 30 s.
- Errors are `Error`s with readable messages: the disc has no audio, is not on MusicBrainz (404 or no release), MusicBrainz is busy (503), answered another status, or could not be reached.

## Cache

Uses the Dexie key/value cache (`src/lib/cache/keyValueCache.ts`: `KeyValueCache`, `DexieKeyValueCache`, `defaultKeyValueCache()`). It is IndexedDB database `cdplayer-cache`, table `entries` (`key`, `value`, `storedAt`). Any structured-cloneable value works, including `Blob`s.

- `musicbrainz.disc.{disc id}`: the `DiscMetadata`, with `coverUrl: null` (a blob URL dies with the page, so the cover is resolved on each lookup).
- `coverart.release.{release id}`: `{ blob, sourceUrl, isOriginal }`.
- A cached original is used with no request. A cached thumbnail (or no cached cover) triggers a Cover Art Archive request to look for the original; if the archive is unreachable the cached thumbnail is kept.
- Failures are not stored, so they are retried the next time the disc is found. A cache that is missing, full or blocked is ignored.
- Existing `localStorage` entries (`cdplayer.musicbrainz.*`) are no longer read.

## In the player

- `CDPlayer` revokes the cover's blob URL (`revokeCoverUrl`) when the disc changes or is removed, and when a lookup finishes for a disc that is no longer current.
- `CDPlayer.metadata` is the result, or `null`. `metadataError` holds the reason when nothing was found.
- `trackTitle(track)` returns the MusicBrainz name, or "Track N" (and "Data track" for a data track). `trackArtist(track)` returns the track's own artist only when it differs from the album's, which is how a compilation shows an Artist column.
- A failed lookup is not an error state: the player becomes `ready` with generic names, and the page says why.

## Limits

- The first matching release is used, with no way to choose another. Reissues and regional pressings may differ in names.
- No fuzzy match by TOC (`?toc=`) when the exact disc ID is unknown, and no link to add an unknown disc to MusicBrainz.
- No custom `User-Agent`. The webview's may be throttled by MusicBrainz. `tauri-plugin-http` (called from JS) would allow one.
- Every lookup tells MusicBrainz which disc is in the drive. The `musicBrainzEnabled` setting ([settings.md](settings.md)) turns lookups off: `CDPlayer` then skips the lookup entirely.
- CD-TEXT is not read.
- MusicBrainz's live service is free for non-commercial use only.

## Tests

- `discId.test.ts`: the two published examples, the alphabet and length, no audio, and the CD-Extra lead-out.
- `musicBrainz.test.ts`: parsing (artist credits, multi-disc releases, no release), cover choice (original, thumbnail fallback), and the lookup against a fake `fetch` and in-memory cache: found, no cover, failed image download, cache hit, thumbnail upgraded to original, offline with cached thumbnail, not found, busy, other statuses, network failure, no audio, and a failing cache. The Dexie class itself is not tested (no IndexedDB in Node).
