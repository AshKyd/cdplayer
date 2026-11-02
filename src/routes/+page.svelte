<script lang="ts">
  import { Button, InfoBox, NotificationArea } from "svelte-akui";
  import { onMount } from "svelte";
  import AlbumHeader from "$lib/components/AlbumHeader/AlbumHeader.svelte";
  import FileDrop from "$lib/components/FileDrop/FileDrop.svelte";
  import LastFmScrobbler from "$lib/components/LastFmScrobbler/LastFmScrobbler.svelte";
  import NowPlaying from "$lib/components/NowPlaying/NowPlaying.svelte";
  import { fileNowPlayingState, nowPlayingControls, nowPlayingState } from "$lib/components/NowPlaying/NowPlayingBridge";
  import SeekBar from "$lib/components/SeekBar/SeekBar.svelte";
  import TrackTable from "$lib/components/TrackTable/TrackTable.svelte";
  import { toFileTrackRows, toTrackRows } from "$lib/components/TrackTable/trackRows";
  import TransportControls from "$lib/components/TransportControls/TransportControls.svelte";
  import Visualiser from "$lib/components/Visualiser/Visualiser.svelte";
  import { CDPlayer } from "$lib/playback/CDPlayer.svelte";
  import { FilePlayer } from "$lib/playback/FilePlayer.svelte";
  import { isDiscReady, isPlaybackActive } from "$lib/playback/playerMachine";
  import { WebAudioHandler } from "$lib/playback/WebAudioHandler";
  import { notifications } from "$lib/notifications/notifications.svelte";
  import { openSettingsWindow } from "$lib/settings/openSettingsWindow";
  import { settings } from "$lib/settings/settings.svelte";
  import type { VisualiserTrackInfo } from "$lib/visualisers/types";
  import CoverTheme from "$lib/components/CoverTheme/CoverTheme.svelte";
  import CoverViewer from "$lib/components/CoverViewer/CoverViewer.svelte";
  import { wipe } from "$lib/transitions/wipe";
  import { withViewTransition } from "$lib/transitions/withViewTransition";
  import { AnimatedWindowHeight } from "$lib/window/AnimatedWindowHeight";
  import { COLLAPSED_PAGE_HEIGHT, DEFAULT_EXPANDED_WINDOW_HEIGHT, DEFAULT_WINDOW_HEIGHT_OFFSET } from "$lib/window/windowHeights";
  import { setWindowFullscreen } from "$lib/window/setWindowFullscreen";
  import { localStorageNumberStore, tauriWindowHeightControl } from "$lib/window/tauriWindowHeightControl";
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

  const filesMode = $derived(mode === "files");
  /** The player the transport, seek bar, visualiser and media keys act on. */
  const active = $derived(filesMode ? filePlayer : player);

  function backToDisc() {
    filePlayer.stop();
    mode = "cd";
  }

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

    // The OS can leave fullscreen without Escape reaching the page (green button, Ctrl+Cmd+F, another Space),
    // which would strand the visualiser alone in a normal window. Only a leave is acted on: entering is
    // asynchronous, so the window isn't fullscreen yet right after the button is pressed.
    const stopWatchingFullscreen = watchWindowFullscreen((fullscreen) => {
      if (!fullscreen) visualiserOnly = false;
    }).catch((error) => {
      console.error(JSON.stringify({ message: "Could not watch fullscreen", error: String(error) }));
      return () => {};
    });

    // The app opens collapsed, so the height the user gives the expanded window is kept for the next launch.
    const stopWatchingUserHeight = windowHeight.watchUserHeight().catch(() => () => {});

    return () => {
      player.destroy();
      filePlayer.destroy();
      void stopWatchingFullscreen.then((stop) => stop());
      void stopWatchingUserHeight.then((stop) => stop());
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
  /** Number of the playing row in `rows`, from 1. */
  const currentRowNumber = $derived(
    filesMode ? (filePlayer.currentIndex === null ? null : filePlayer.currentIndex + 1) : player.trackNumber,
  );
  const canNext = $derived(
    filesMode
      ? filePlayer.currentIndex !== null && filePlayer.currentIndex < filePlayer.tracks.length - 1
      : player.queue.length > 1,
  );
  const visualiserTrack = $derived.by((): VisualiserTrackInfo | null => {
    if (filesMode) {
      if (!filePlayer.current || filePlayer.currentIndex === null) return null;
      return {
        number: filePlayer.currentIndex + 1,
        title: filePlayer.current.title,
        artist: "",
        durationSeconds: filePlayer.durationSeconds,
      };
    }
    const track = player.tracks.find(({ number }) => number === player.trackNumber);
    if (!track) return null;
    return {
      number: track.number,
      title: player.trackTitle(track),
      artist: player.trackArtist(track) || player.metadata?.artist || "",
      durationSeconds: player.durationSeconds,
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

  // With no track list the window shrinks to fit the header, and grows back to the user's height when tracks arrive.
  const windowHeight = new AnimatedWindowHeight({
    control: tauriWindowHeightControl(),
    offsetStore: localStorageNumberStore("cdplayer.windowHeightOffset"),
    initialOffset: DEFAULT_WINDOW_HEIGHT_OFFSET,
    expandedHeightStore: localStorageNumberStore("cdplayer.expandedWindowHeight"),
    defaultExpandedHeight: DEFAULT_EXPANDED_WINDOW_HEIGHT,
  });
  let mainElement: HTMLElement;

  /** Height the page needs above the track list: everything but the track section, plus the page's bottom padding. */
  let contentHeight = $state(0);

  const measureContentHeight = (): number => {
    const [lowestChrome] = [...mainElement.children].filter((child) => child.tagName !== "SECTION").reverse();
    const bottomPadding = Number.parseFloat(getComputedStyle(mainElement).paddingBottom) || 0;
    return Math.ceil((lowestChrome?.getBoundingClientRect().bottom ?? 0) + bottomPadding);
  };

  // The header's size changes after the first paint (text fitting, wrapping at narrow widths), so keep measuring it.
  onMount(() => {
    const observer = new ResizeObserver(() => (contentHeight = measureContentHeight()));
    [...mainElement.children].filter((child) => child.tagName !== "SECTION").forEach((child) => observer.observe(child));
    contentHeight = measureContentHeight();
    return () => observer.disconnect();
  });

  $effect(() => {
    // Fullscreen is entered and left asynchronously, so leave the size alone around it.
    if (visualiserOnly) return;
    // Known up front, so the first collapse doesn't wait for a measurement; the measured height only ever adds to it.
    const collapsedHeight = Math.max(COLLAPSED_PAGE_HEIGHT, contentHeight);
    // This is also the window's minimum, so it can't be dragged smaller than the header, collapsed or not.
    windowHeight.setMinimumHeight(collapsedHeight);
    const action = isNothingToShow ? windowHeight.collapseTo(collapsedHeight) : windowHeight.restore();
    action.catch((error) => {
      console.error(JSON.stringify({ message: "Could not resize the window", error: String(error) }));
    });
  });
  const albumPlaceholder = $derived(
    filesMode
      ? (filePlayer.current?.title ?? "Audio files")
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
<!-- Dropped files have no artist, which Last.fm needs, so only the disc is scrobbled. -->
<LastFmScrobbler {player} />
<CoverTheme coverUrl={filesMode ? undefined : player.metadata?.coverUrl} reading={!filesMode && isReadingDisc} />
<FileDrop onfiles={(paths) => filePlayer.enqueue(paths)} />
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
      track={visualiserTrack}
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

<main class:hidden={visualiserOnly} bind:this={mainElement}>
  <header>
    <!-- Always shown, so the header keeps its size when there is no disc. A new disc wipes over the old one. -->
    <div class="album">
      {#key filesMode ? "files" : (player.metadata?.discId ?? "none")}
        <div class="album-slot" transition:wipe>
          <AlbumHeader
            metadata={filesMode ? null : player.metadata}
            message={albumPlaceholder}
            busy={!filesMode && isReadingDisc}
            coverOpen={isCoverOpen}
            onopencover={() => setCoverOpen(true)}
          />
        </div>
      {/key}
    </div>
    <div class="controls">
      <TransportControls
        playing={isSounding}
        disabled={isTransportDisabled}
        canPrevious={isActive}
        {canNext}
        onprevious={() => void active.previous()}
        onplaypause={() => void active.playPause()}
        onnext={() => void active.next()}
      />
      <SeekBar
        positionSeconds={active.positionSeconds}
        durationSeconds={active.durationSeconds}
        disabled={isNothingToShow || !isActive}
        onseek={(seconds) => void active.seek(seconds)}
      />
      <div class="window-buttons">
        {#if filesMode}
          <Button variant="ghost" icon="disc" iconPosition="only" aria-label="Back to disc" onclick={backToDisc} />
        {/if}
        <Button
          variant="ghost"
          icon="gear"
          iconPosition="only"
          aria-label="Settings"
          onclick={() => void openSettingsWindow()}
        />
        <Button
          variant="ghost"
          icon="fullscreen"
          iconPosition="only"
          aria-label="Fullscreen visualiser"
          onclick={() => setVisualiserOnly(true)}
        />
      </div>
    </div>
  </header>

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

  {#if !isNothingToShow}
    {#if !filesMode && !player.metadata && player.metadataError}
      <p class="hint">Track names unavailable: {player.metadataError}.</p>
    {/if}
    <section>
      <TrackTable {rows} currentTrackNumber={currentRowNumber} playing={isSounding} onplay={({ key }) => playRow(key)} />
    </section>
  {/if}
</main>

<style>
  main {
    /* Above the background visualiser. */
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    height: 100vh;
    padding: 0.75rem 1rem 1rem;
  }

  /* Visualiser-only mode: hide all page chrome, keeping the player mounted so playback continues. */
  main.hidden {
    display: none;
  }

  header {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem 1.5rem;
    align-items: center;
    padding-block: 1rem;
  }

  /* Fixed width so the controls don't shift between discs; longer text wraps to two lines, then scales down to fit. */
  .album {
    /* The old and new album share one cell while they wipe, so they overlap instead of stacking. */
    display: grid;
    flex: 0 1 16rem;
    min-width: 0;
    width: 16rem;
  }

  .album-slot {
    grid-area: 1 / 1;
    min-width: 0;
  }

  .controls {
    display: flex;
    flex: 1 1 0;
    gap: 1.25rem;
    align-items: center;
    min-width: 0;
  }

  .window-buttons {
    display: flex;
    flex: none;
    gap: 0.125rem;
  }

  /* Narrow: the controls take the first line and the album drops below them. */
  @media (max-width: 45rem) {
    .controls {
      flex-basis: 100%;
    }

    .album {
      order: 1;
      width: 100%;
      flex-basis: 100%;
    }
  }

  section {
    flex: 1;
    min-height: 0;
    /* Frosted glass: blurs the waveform behind the table, with a light tint so the text stays readable. */
    background: color-mix(in srgb, var(--akui-bg) 55%, transparent);
    backdrop-filter: blur(12px);
    border-radius: var(--akui-radius-m);
  }

  .hint {
    color: var(--akui-fg-secondary);
  }
</style>
