# Notifications

Toasts in the bottom right corner, for problems that shouldn't stop the app. Built on the akui `NotificationArea`.

## Files

- `src/lib/notifications/notifications.svelte.ts`: the `notifications` store and the `Problem` type.
- `src/routes/+page.svelte`: renders `NotificationArea` from `notifications.items`.

## API

- `notifications.notify({ variant, title, message })`: adds a toast. `variant` is `error` or `warning`.
- `notifications.dismiss(id)`: removes one. The `NotificationArea` calls it from the × button and when a toast times out.
- `notifications.items`: the toasts, oldest first (`$state`).

## Behaviour

- Each toast lasts 10 s, which is above akui's 5 s minimum.
- Used by `FilePlayer` (its `onProblem` option): a file that can't be played ("Couldn't play {name}") and a file with damaged audio, once per file.
- CD playback errors still use the page's `InfoBox` banner ("Playback stopped"), since they stop the player.

## Limits

- Only the main window shows them; the settings window is a separate page with its own store.
- Not saved: a toast that times out is gone.
