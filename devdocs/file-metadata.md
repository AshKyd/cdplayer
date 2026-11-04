# File metadata (JS)

Fills a file's title, artist, album and track number from its tags. Rust returns every tag unfiltered (`get_metadata`, see [file-decoder.md](file-decoder.md)); the JS side chooses which ones matter.

## Files

- `src/lib/files/fileMetadata.ts`: `FileTag`, `readFileTags`, `pickTrackInfo`.
- `src/lib/files/fileTrack.ts`: `applyTags`, and the tag fields on `FileTrack`.
- `src/lib/playback/FilePlayer.svelte.ts`: reads tags when files are added.

## API

- `readFileTags(path, { invokeCommand })`: calls `get_metadata`. Resolves to `[]` if the file can't be read, so a failure only leaves the file name as the title.
- `pickTrackInfo(tags)`: `{ title, artist, album, albumArtist, trackNumber, year }`, each `undefined` when missing. Matches by `standard` name first, then by raw key (case-insensitive) for the common ID3, Vorbis, MP4 and RIFF keys. Takes the first non-empty value. `trackNumber` reads `3/12` as 3; `year` is the first four digits of a date.
- `applyTags(track, tags)`: a copy of the `FileTrack` with those fields set and `tags` stored. A missing tag keeps the existing value, so a file with no title tag keeps its file name.

## Behaviour

- `FilePlayer.enqueue` adds the tracks (titled from the file name), then reads their tags one file at a time, top to bottom, and fills them in. It is in series so an optical drive isn't made to seek between files. Playback never waits on tags.
- Each track is found again by `id` when its tags arrive, so tags for a cleared playlist are dropped.
- Files with no tags (an empty list) are left alone.

## Limits

- No cover art.
- The playlist is never reordered by track number: it stays in the order the files were given (the disc's order) on purpose.
