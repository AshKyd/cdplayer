# Last.fm

Sends "now playing" and scrobbles to Last.fm while a disc plays. All JS, no Rust (Last.fm allows cross-origin requests).

## Files

- `src/lib/lastfm/md5.ts`: `md5()`. WebCrypto has no MD5, and Last.fm's login and request signing need it.
- `src/lib/lastfm/lastFmClient.ts`: `LastFmClient` (`login()`, `getProfile()`, `updateNowPlaying()`, `scrobble()`), `signParams()`, `authToken()`.
- `src/lib/lastfm/defaultLastFmClient.ts`: `createDefaultLastFmClient()`, using the `.env` key.
- `src/lib/components/LastFmScrobbler/ScrobbleTracker.ts`: decides when to send. `playbackSnapshot()` reads the player.
- `src/lib/components/LastFmScrobbler/LastFmScrobbler.svelte`: feeds the player's state to the tracker and sends through the client. Mounted on the main page.
- `.env.example`: the two build-time variables.

## Setup

- Create an API account at https://www.last.fm/api/account/create.
- Put the key and shared secret in `.env` as `VITE_LASTFM_API_KEY` and `VITE_LASTFM_API_SECRET`, then restart the dev server or rebuild.
- Without them nothing is sent, and the settings page says so.

## Login

- `src/lib/components/LastFmSettings/LastFmSettings.svelte` is the settings "Last.fm" section. Its logic is `LastFmLogin` (`lastFmLogin.svelte.ts`): `login()`, `logout()`, `loadProfile()`.
- Logged out: username and password fields and a "Log in" button. The button checks the credentials with `LastFmClient.login()`. Only if Last.fm accepts them are `lastFmUsername` (the account's own spelling) and `lastFmPasswordHash` saved ([settings.md](settings.md)); a wrong password shows "Wrong username or password." and saves nothing.
- Logged in (both settings saved): shows the profile picture, username (links to the profile) and scrobble count, from `user.getInfo`, with a "Log out" button that clears both settings. If the profile can't be loaded, the username still shows with an error.
- Only `md5(password)` is saved. The typed password is kept in the settings window's memory and cleared after a successful login.
- `LastFmClient` logs in with `auth.getMobileSession` using `authToken = md5(lowercase username + passwordHash)`, and keeps the session key in memory per login. If Last.fm answers error 9 (bad session), it logs in again once.

## Behaviour

- Now playing: sent once when a track first makes a sound (`status` is `playing`, not `loading`).
- Scrobble: sent once per play, when the track is over 30 s long and has been listened to for half its length or 4 minutes, whichever is first. The timestamp is when the track began.
- Listening time is added from steady forward movement of `positionSeconds` while playing. Pausing adds nothing and seeking ahead adds nothing.
- Starting a scrobbled track over counts as a new play.
- Needs MusicBrainz metadata: tracks with no artist (disc not found, lookups off) are not sent.
- Everything is logged to the main window's console as one JSON line, `[lastfm] {...}`:
  - `{"event":"ready","apiKeySet":...}` when the component mounts.
  - `{"action":"nowPlaying"|"scrobble", "artist", "title", "album", "result":"sending"|"ok"|"failed"|"skipped"}`. A `skipped` has a `reason` (no API key, username or password); a `failed` has an `error`.
  - `{"action":"ignored","trackNumber","reason"}` once for a track with no artist or title.
- A failed send is dropped. Playback never waits on it.

## Limits

- No offline queue: a scrobble that fails (offline, Last.fm down) is lost.
- A wrong password or missing API key only shows in the console log, not in the UI.
- The API secret is compiled into the app, as it is for any desktop scrobbler.
- The password hash is stored in `localStorage` and sent to other windows. It is equivalent to the password for Last.fm's login.
