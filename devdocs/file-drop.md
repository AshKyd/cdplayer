# FileDrop

Lets audio files be dropped anywhere on the window. Renders a drop overlay while files are dragged over.

## Files

- `src/lib/components/FileDrop/FileDrop.svelte`
- `src/lib/files/audioFiles.ts`: filters the dropped paths.

## API

- Prop `onfiles(paths: string[])`: called with the paths of the audio files of a drop, in the order given. Not called if there are none.

## Behaviour

- Listens with Tauri's `getCurrentWebview().onDragDropEvent`. Tauri takes file drops from the OS itself and reports their paths; Rust needs a path to open a file ([file-decoder.md](file-decoder.md)). The window keeps the default `dragDropEnabled`.
- The overlay shows on `enter` when at least one dragged path is audio, and hides on `leave` and `drop`.
- The page passes `onfiles` to `FilePlayer.enqueue()`.
- A path is audio if its extension is mp3, m4a, mp4, aac, flac, ogg, oga, wav, aif, aiff, caf or mka. Folders are left out.

## Limits

- Folders are not read.
- Needs Tauri; outside it (a plain browser, Storybook) drops are not handled.
