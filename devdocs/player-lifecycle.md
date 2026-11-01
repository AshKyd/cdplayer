# Player lifecycle

`CDPlayer` is one state machine from "no disc" to playing a track. The rules are a pure function, `transition(status, event)` in `src/lib/playback/playerMachine.ts`. The class sends events through `#dispatch()`; an event that the current state doesn't allow is ignored. This keeps each step tied to the state, instead of scattered `if` checks.

## States

- `noDisc`: nothing in the drive, or the drive has not been looked at yet.
- `loadingMetadata`: a disc was found and its track names are being looked up.
- `ready`: a disc is there, with names from MusicBrainz or the generic "Track N" if the lookup failed. Nothing playing.
- `loading`: playing was asked for; waiting for the first audio.
- `playing`.
- `buffering`: playing, but the audio ran out before the next chunk arrived.
- `paused`: by the user, or by the system interrupting the audio (the `interrupted` flag).

The tracks are not shown until the metadata lookup has finished (`ready` or later). A failed lookup is `ready` with generic names, not an error state.

## Events and transitions

- `discInserted`: any state to `loadingMetadata`. A disc swapped in while another was there starts again from here.
- `discRemoved`: any state except `noDisc` to `noDisc`.
- `metadataSettled`: `loadingMetadata` to `ready`. Sent whether the lookup found the disc or not.
- `play`: `ready`, `loading`, `playing`, `buffering` or `paused` to `loading`. Not allowed with no disc or while the metadata loads.
- `chunkArrived`: `loading` or `buffering` to `playing`.
- `underrun`: `playing` to `buffering`.
- `pause`: `loading`, `playing` or `buffering` to `paused`.
- `resume`: `paused` to `playing`, `buffering` or `loading`, whichever the audio is doing now.
- `stop`: `loading`, `playing`, `buffering` or `paused` to `ready`. Used for the user's stop, the end of the queue, and a playback error.

```text
noDisc ──discInserted──▶ loadingMetadata ──metadataSettled──▶ ready ──play──▶ loading ──chunkArrived──▶ playing
   ▲                                                            ▲                │                      │ ▲
   └─────────────── discRemoved (from any state) ───────────────┤       pause ◀──┴──────────────────────┘ │ underrun / chunkArrived
                                                                └──── stop (from any playback state) ─── paused ◀─ buffering
```

## Who sends what

- Disc events come from the `DiscWatcher` that `CDPlayer` owns. It polls `get_toc` while no audio is active (see [disc-watcher.md](disc-watcher.md)). A change tears down any playback and sends `discInserted` or `discRemoved`.
- A failed chunk read stops playback (`stop`) and checks the drive straight away, which sends `discRemoved` if the disc is gone.
- `underrun`, `chunkArrived` and the end of the queue come from the audio (`WebAudioHandler`'s `onEnded`) and the fetch loop.
- The system interrupting the audio sets `interrupted` and sends `pause`; its recovery sends `resume`.
- Everything else is a user action: `playQueue()`, `playFrom()`, `playPause()`, `previous()`, `next()`, `seek()`, `pause()`, `resume()` and `stop()`.

## What stays outside the status

These are facts about a run, not steps, so they are fields next to `status`: `interrupted`, `error`, `unreadableSectors`, `queue`, `trackNumber`, `positionSeconds`, `metadata`, `metadataError`.

## Stale work

Slow steps can finish after the state has moved on. Each is tied to a counter and ignored if it is out of date:

- the metadata lookup, by a disc counter (a lookup for a disc that was since swapped or removed is dropped);
- the fetch loop, by a run id and a fetch generation (a loop for a stopped run, or for buffered tracks that were dropped, stops).

## Limits

- The machine covers one disc and one queue. There is no state for choosing between several matching releases.
- `interrupted` and the paused-by-interruption flag are not states of their own.
- Tested with fake timers and fakes for the drive, MusicBrainz and the audio context; not against real hardware.

## Tests

- `playerMachine.test.ts`: the whole transition table (every event in every state) and a walk through a normal disc.
- `CDPlayer.svelte.test.ts`: the disc lifecycle (no disc, loading metadata, failed lookup, swapped disc, eject, errors) and the transport.
