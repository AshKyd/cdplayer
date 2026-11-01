# DiscWatcher

Finds out which disc is in the drive by asking for its TOC at an interval, and reports when it changes: a disc inserted, swapped or ejected, or no disc at startup. The polling is in JS. Rust only answers "what is in the drive now" (`get_toc`, see [cd-bridge.md](cd-bridge.md)).

## Files

- `src/lib/disc/DiscWatcher.svelte.ts`: the class (Svelte 5 runes).
- `src/lib/disc/tocFingerprint.ts`: `tocFingerprint(toc | null)`, a string that is the same for the same disc and different for another disc (every track's sectors and type, plus the lead-out). `null` (no disc) has its own value.
- Used by `src/routes/+page.svelte`.

## API

- `new DiscWatcher({ loadToc, isBusy, intervalMs, onChange })`. All options are optional.
  - `loadToc`: reads the TOC. Defaults to `invoke("get_toc")`. Tests pass a fake.
  - `isBusy`: true while the drive is in use. The page passes `player.status !== "idle"`.
  - `intervalMs`: time between checks. Default 3000.
  - `onChange(toc | null)`: called when the disc changes. The page calls `player.stop()`.
- State: `toc`, `error` (why there is no disc, or empty), `checking`.
- `start()`: checks now, then every `intervalMs`. `stop()`.
- `checkNow()`: one check. Does nothing while busy or while another check is running.

## Behaviour

- A change is a different fingerprint from the last check. The first check always counts as a change, and so does the first "no disc".
- `error` is updated on every check, but `onChange` is only called on a change, so an empty drive is reported once.
- Checks are skipped while `isBusy()` is true. Re-opening the drive during playback would cut off reads.
- The page also calls `checkNow()` when `CDPlayer.error` is set. A failed read while playing usually means the disc was ejected, and playback has already stopped, so the watcher is free to look.
- The page's "Check for disc" button calls `checkNow()`.

## Limits

- Detection takes up to one interval (3 s).
- Nothing is checked while playing or paused. A disc swapped during a pause is only noticed after playback stops or a read fails.
- Each check opens the drive and releases it straight after, so the disc can be ejected between checks. An eject at the instant of a check can still be refused. Whether the open wakes or spins up a drive is untested on real hardware; change `intervalMs` if it does.
- It reads only the first drive with an audio CD.

## Tests

- `npm test` covers the fingerprint and the watcher with a fake drive and fake timers: first disc, repeated reads, swap, eject, return, busy, overlapping checks and `stop()`.
- Polling against a real drive is tested by hand.
