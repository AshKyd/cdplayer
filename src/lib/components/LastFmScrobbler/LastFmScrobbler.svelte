<script lang="ts">
  import { createDefaultLastFmClient } from "$lib/lastfm/defaultLastFmClient";
  import type { LastFmCredentials, LastFmTrack } from "$lib/lastfm/lastFmClient";
  import type { CDPlayer } from "$lib/playback/CDPlayer.svelte";
  import { settings } from "$lib/settings/settings.svelte";
  import { playbackSnapshot, ScrobbleTracker } from "./ScrobbleTracker";

  interface Props {
    /** The player whose tracks are sent to Last.fm. */
    player: CDPlayer;
  }

  let { player }: Props = $props();

  const client = createDefaultLastFmClient();

  /** One string per line so the details can be copied out of the console. */
  const log = (details: Record<string, unknown>) => console.log(`[lastfm] ${JSON.stringify(details)}`);

  log({ event: "ready", apiKeySet: client.isConfigured });

  /** Why nothing can be sent right now, or `null` if it can. Read at the moment of sending, so a change applies at once. */
  const unavailableReason = (): string | null => {
    if (!client.isConfigured) return "no API key (VITE_LASTFM_API_KEY / VITE_LASTFM_API_SECRET)";
    if (!settings.lastFmUsername) return "no username in settings";
    if (!settings.lastFmPasswordHash) return "no password in settings";
    return null;
  };

  /** Logs the attempt and its outcome. A failed send is dropped: playback never waits on Last.fm. */
  const send = (
    action: string,
    track: LastFmTrack,
    request: (login: LastFmCredentials) => Promise<void>,
    extra: Record<string, unknown> = {},
  ) => {
    const details = { action, artist: track.artist, title: track.title, album: track.album, ...extra };
    const reason = unavailableReason();
    if (reason) return log({ ...details, result: "skipped", reason });

    log({ ...details, result: "sending" });
    request({ username: settings.lastFmUsername, passwordHash: settings.lastFmPasswordHash }).then(
      () => log({ ...details, result: "ok" }),
      (error) => log({ ...details, result: "failed", error: error instanceof Error ? error.message : String(error) }),
    );
  };

  const tracker = new ScrobbleTracker({
    onNowPlaying: (track) => send("nowPlaying", track, (login) => client.updateNowPlaying(login, track)),
    onScrobble: (track, startedAtSeconds) =>
      send("scrobble", track, (login) => client.scrobble(login, track, startedAtSeconds), { startedAtSeconds: Math.floor(startedAtSeconds) }),
    onIgnored: (trackNumber, reason) => log({ action: "ignored", trackNumber, reason }),
  });

  $effect(() => tracker.update(playbackSnapshot(player)));
</script>
