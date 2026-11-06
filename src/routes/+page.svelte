<script lang="ts">
  import { InfoBox, NotificationArea } from "svelte-akui";
  import { onMount } from "svelte";
  import AppControls from "$lib/components/AppControls/AppControls.svelte";
  import LastFmScrobbler from "$lib/components/LastFmScrobbler/LastFmScrobbler.svelte";
  import NowPlaying from "$lib/components/NowPlaying/NowPlaying.svelte";
  import { fileNowPlayingState, nowPlayingControls, nowPlayingState } from "$lib/components/NowPlaying/NowPlayingBridge";
  import TrackTable from "$lib/components/TrackTable/TrackTable.svelte";
  import { toFileTrackRows, toTrackRows } from "$lib/components/TrackTable/trackRows";
  import Visualiser from "$lib/components/Visualiser/Visualiser.svelte";
  import { CDPlayer } from "$lib/playback/CDPlayer.svelte";
  import { FilePlayer } from "$lib/playback/FilePlayer.svelte";
  import { isDiscReady, isPlaybackActive } from "$lib/playback/playerMachine";
  import { WebAudioHandler } from "$lib/playback/WebAudioHandler";
  import { notifications } from "$lib/notifications/notifications.svelte";
  import { openSettingsWindow } from "$lib/settings/openSettingsWindow";
  import { settings } from "$lib/settings/settings.svelte";
  import { isInside, normalisePath } from "$lib/volumes/paths";
  import { VolumeFilesLoader } from "$lib/volumes/VolumeFilesLoader.svelte";
  import CoverTheme from "$lib/components/CoverTheme/CoverTheme.svelte";
  import CoverViewer from "$lib/components/CoverViewer/CoverViewer.svelte";
  import { riseFade } from "$lib/transitions/riseFade";
  import { withViewTransition } from "$lib/transitions/withViewTransition";
  import { setWindowFullscreen } from "$lib/window/setWindowFullscreen";
  import { watchWindowFullscreen } from "$lib/window/watchWindowFullscreen";

  /** One audio output (and one visualiser tap) shared by both players; whichever starts a run takes it over. */
  const handler = new WebAudioHandler({ fadeSeconds: () => (settings.fadeEnabled ? 0.1 : 0) });

  /** Which source the page is showing and controlling. Changes when either player starts. */
  let mode = $state<"cd" | "files">("cd");

  const player = new CDPlayer({
    handler,
    onBeforePlay: () => {
      filePlayer.release();
      mode = "cd";
    },
    // Putting an audio disc in takes over from files, as ejecting an MP3 CD does.
    onDiscChange: (toc) => {
      if (!toc || mode !== "files") return;
      filePlayer.stop();
      mode = "cd";
    },
  });
  const filePlayer = new FilePlayer({
    handler,
    onBeforePlay: () => {
      player.release();
      mode = "files";
    },
    // A file that can't be played shouldn't interrupt the rest of the playlist, so it is a toast, not a banner.
    onProblem: (problem) => notifications.notify(problem),
  });

  /** Plays data and MP3 CDs. An audio CD in the drive wins, and a disc of files never interrupts anything playing. */
  const volumeLoader = new VolumeFilesLoader({
    canLoad: () => player.status === "noDisc" && !player.readingDisc && !filePlayer.isActive,
    onFiles: (paths) => {
      filePlayer.clear();
      mode = "files";
      filePlayer.enqueue(paths, { play: settings.autoplayEnabled });
    },
    // The files can't be read any more, so the player goes back to the (empty) drive rather than failing on each one.
    onRemoved: ({ mount_path }) => {
      const mountPath = normalisePath(mount_path);
      if (!filePlayer.tracks.some(({ path }) => isInside(normalisePath(path), mountPath))) return;
      filePlayer.clear();
      mode = "cd";
    },
  });

  const filesMode = $derived(mode === "files");
  /** The player the transport, seek bar, visualiser and media keys act on. */
  const active = $derived(filesMode ? filePlayer : player);

  /** Plays the row that was chosen in the track table, whichever source it lists. */
  const playRow = (key: string) => {
    if (filesMode) {
      const fileTrack = filePlayer.tracks.find(({ id }) => id === key);
      if (fileTrack) void filePlayer.playFrom(fileTrack);
      return;
    }
    const discTrack = player.tracks.find(({ number }) => String(number) === key);
    if (discTrack) void player.playFrom(discTrack);
  };

  /** Fullscreen with only the visualiser showing; Escape leaves it. */
  let visualiserOnly = $state(false);

  function setVisualiserOnly(enabled: boolean) {
    visualiserOnly = enabled;
    setWindowFullscreen(enabled).catch((error) => {
      console.error(JSON.stringify({ message: "Could not change fullscreen", error: String(error) }));
      // The window didn't change, so don't leave the page showing only the visualiser in a normal window.
      if (enabled) visualiserOnly = false;
    });
  }

  /** The track list is shown. Hiding it leaves the visualiser behind the controls. */
  let playlistVisible = $state(true);

  /** The cover is shown full size. */
  let isCoverOpen = $state(false);

  /** The cover morphs between the header and the full-size view. */
  const setCoverOpen = (open: boolean) => withViewTransition(() => (isCoverOpen = open));

  // A disc change or eject closes the viewer, so the next disc doesn't open already full size.
  $effect(() => {
    if (filesMode || !player.metadata?.coverUrl) isCoverOpen = false;
  });

  onMount(() => {
    player.start();
    volumeLoader.start();

    // The OS can leave fullscreen without Escape reaching the page (green button, Ctrl+Cmd+F, another Space),
    // which would strand the visualiser alone in a normal window. Only a leave is acted on: entering is
    // asynchronous, so the window isn't fullscreen yet right after the button is pressed.
    const stopWatchingFullscreen = watchWindowFullscreen((fullscreen) => {
      if (!fullscreen) visualiserOnly = false;
    }).catch((error) => {
      console.error(JSON.stringify({ message: "Could not watch fullscreen", error: String(error) }));
      return () => {};
    });

    return () => {
      volumeLoader.stop();
      player.destroy();
      filePlayer.destroy();
      void stopWatchingFullscreen.then((stop) => stop());
    };
  });

  const hasPlayableTrack = $derived(player.tracks.some(({ is_audio }) => is_audio));
  const isActive = $derived(filesMode ? filePlayer.isActive : isPlaybackActive(player.status));
  /** Audio is moving (or about to), as opposed to stopped or paused. Both players use these status names. */
  const isSounding = $derived(["loading", "playing", "buffering"].includes(active.status));
  const rows = $derived(
    filesMode
      ? toFileTrackRows(filePlayer.tracks)
      : toTrackRows(
          player.tracks,
          (track) => player.trackTitle(track),
          (track) => player.trackArtist(track),
        ),
  );
  /** A list of one track has nothing to choose between, so it is never shown (and has no toggle to hide it). */
  const hasPlaylist = $derived(rows.length >= 2);
  /** Number of the playing row in `rows`, from 1. */
  const currentRowNumber = $derived(
    filesMode ? (filePlayer.currentIndex === null ? null : filePlayer.currentIndex + 1) : player.trackNumber,
  );
  const canNext = $derived(
    filesMode
      ? filePlayer.currentIndex !== null && filePlayer.currentIndex < filePlayer.tracks.length - 1
      : player.queue.length > 1,
  );
  /**
   * The track being played, shown in the album header in place of the album. Missing parts drop out of the
   * header; a file with no title tag is titled by its file name.
   */
  const currentTrack = $derived.by(() => {
    if (filesMode) {
      const { current } = filePlayer;
      return current ? { title: current.title, artist: current.artist ?? "", year: current.year ?? "" } : null;
    }
    const track = player.tracks.find(({ number }) => number === player.trackNumber);
    if (!track?.is_audio) return null;
    return {
      title: player.trackTitle(track),
      artist: player.trackArtist(track) || player.metadata?.artist || "",
      year: player.metadata?.year ?? "",
    };
  });
  /** True while the disc is being read or looked up. */
  const isReadingDisc = $derived(player.status === "loadingMetadata" || (player.status === "noDisc" && player.readingDisc));
  /** There is nothing to show yet: no disc, or still reading it (never the case while showing files). */
  const isNothingToShow = $derived(!filesMode && (player.status === "noDisc" || player.status === "loadingMetadata"));
  /** The transport can't start anything: no playable disc track, or no files. */
  const isTransportDisabled = $derived(
    filesMode
      ? filePlayer.tracks.length === 0
      : isNothingToShow || !hasPlayableTrack || !isDiscReady(player.status),
  );
  /** What the system media keys do, acting on whichever player is showing when the key is pressed. */
  const mediaKeyControls = nowPlayingControls({
    resume: () => active.resume(),
    pause: () => active.pause(),
    previous: () => active.previous(),
    next: () => active.next(),
    seek: (seconds) => active.seek(seconds),
    stop: () => active.stop(),
  });

  const albumPlaceholder = $derived(
    filesMode
      ? (filePlayer.current?.title ?? volumeLoader.loaded?.label ?? "Audio files")
      : player.status === "loadingMetadata"
      ? "Looking up album…"
      : player.status === "noDisc"
        ? isReadingDisc
          ? "Reading disc…"
          : "No disc"
        : "Unknown disc",
  );
</script>

<NowPlaying
  nowPlaying={filesMode ? fileNowPlayingState(filePlayer) : nowPlayingState(player)}
  controls={mediaKeyControls}
/>
<!-- Files have no artist, which Last.fm needs, so only the disc is scrobbled. -->
<LastFmScrobbler {player} />
<CoverTheme coverUrl={filesMode ? undefined : player.metadata?.coverUrl} reading={!filesMode && isReadingDisc} />
<NotificationArea
  items={notifications.items}
  onDismiss={(id) => notifications.dismiss(id)}
  position="bottom-right"
  label="Notifications"
/>

<svelte:window onkeydown={(event) => visualiserOnly && event.key === "Escape" && setVisualiserOnly(false)} />

{#if settings.visualiserEnabled || visualiserOnly}
  <!-- Keyed so choosing another visualiser in settings starts a fresh canvas. -->
  {#key settings.visualiserId}
    <Visualiser
      visualiserId={settings.visualiserId}
      readWaveform={(target) => active.readWaveform(target)}
      playing={isSounding}
    />
  {/key}
{/if}

{#if isCoverOpen && player.metadata?.coverUrl}
  <CoverViewer
    coverUrl={player.metadata.coverUrl}
    alt="Cover of {player.metadata.album}"
    onclose={() => setCoverOpen(false)}
  />
{/if}

<main class:hidden={visualiserOnly}>
  {#if active.interrupted}
    <InfoBox variant="warning" title="Audio output was interrupted">Press Play to continue.</InfoBox>
  {/if}
  {#if !filesMode && player.unreadableSectors > 0}
    <InfoBox variant="warning" title="Unreadable sectors">
      {player.unreadableSectors} sector{player.unreadableSectors === 1 ? "" : "s"} played as silence. The disc may
      be scratched or dirty.
    </InfoBox>
  {/if}
  {#if !filesMode && player.error}
    <InfoBox variant="error" title="Playback stopped">{player.error}</InfoBox>
  {/if}

  {#if !isNothingToShow && hasPlaylist && playlistVisible}
    {#if !filesMode && !player.metadata && player.metadataError}
      <p class="hint">Track names unavailable: {player.metadataError}.</p>
    {/if}
    <section transition:riseFade>
      <TrackTable {rows} currentTrackNumber={currentRowNumber} playing={isSounding} onplay={({ key }) => playRow(key)} />
    </section>
  {/if}

  <!-- Below the playlist, so it stays at the bottom edge of the window. -->
  <div class="controls-bar">
  <AppControls
    metadata={filesMode ? null : player.metadata}
    message={albumPlaceholder}
    busy={!filesMode && isReadingDisc}
    coverOpen={isCoverOpen}
    track={currentTrack}
    coverless={filesMode}
    playing={isSounding}
    transportDisabled={isTransportDisabled}
    canPrevious={isActive}
    {canNext}
    positionSeconds={active.positionSeconds}
    durationSeconds={active.durationSeconds}
    seekDisabled={isTransportDisabled || !isActive}
    bind:playlistVisible
    playlistToggleable={hasPlaylist}
    onopencover={() => setCoverOpen(true)}
    onprevious={() => void active.previous()}
    onplaypause={() => void active.playPause()}
    onnext={() => void active.next()}
    onseek={(seconds) => void active.seek(seconds)}
    onsettings={() => void openSettingsWindow()}
    onfullscreen={() => setVisualiserOnly(true)}
  />
  </div>
</main>

<style>
  main {
    /* Above the background visualiser. */
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    /* Keeps the controls on the bottom edge when there is no track list. */
    justify-content: flex-end;
    gap: 0.75rem;
    height: 100vh;
    /* No bottom padding: the controls bar runs to the window's bottom edge. */
    padding: 0.75rem 1rem 0;
  }

  /* The bottom of the window is frosted glass, edge to edge, with a faint line along its top. */
  .controls-bar {
    /* Cancels main's side padding so the bar spans the window; its own padding keeps the controls in line with the playlist. */
    margin-inline: -1rem;
    padding-inline: 1rem;
    background: color-mix(in srgb, var(--akui-bg) 40%, transparent);
    backdrop-filter: blur(12px);
    border-top: 1px solid color-mix(in srgb, var(--akui-fg) 10%, transparent);
  }

  /* Visualiser-only mode: hide all page chrome, keeping the player mounted so playback continues. */
  main.hidden {
    display: none;
  }

  section {
    flex: 1;
    min-height: 0;
    /* Frosted glass: blurs the waveform behind the table, with a light tint so the text stays readable. */
    background: color-mix(in srgb, var(--akui-bg) 55%, transparent);
    backdrop-filter: blur(12px);
    border-radius: var(--akui-radius-m);
    /* Space above the first row, now that the table header is hidden. */
    padding-top: 0.75rem;
    /* Gets its own layer before the transition starts, so the first animated frame isn't spent promoting it. */
    will-change: transform, opacity;
  }

  .hint {
    color: var(--akui-fg-secondary);
  }
</style>
