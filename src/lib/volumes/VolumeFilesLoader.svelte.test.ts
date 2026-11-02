import { describe, expect, it, vi } from "vitest";
import type { OpticalVolume } from "./types";
import { VolumeFilesLoader } from "./VolumeFilesLoader.svelte";

const mp3Disc: OpticalVolume = { mount_path: "/Volumes/MP3", label: "MP3" };
const otherDisc: OpticalVolume = { mount_path: "/Volumes/Other", label: "Other" };

const setup = ({ canLoad = (): boolean => true, files = ["/Volumes/MP3/a.mp3"] } = {}) => {
  const state = { mounted: [] as OpticalVolume[] };
  const onFiles = vi.fn();
  const onRemoved = vi.fn();
  const loader = new VolumeFilesLoader({
    loadVolumes: async () => state.mounted,
    listFiles: async () => files,
    canLoad,
    onFiles,
    onRemoved,
  });
  return { state, loader, onFiles, onRemoved };
};

describe("VolumeFilesLoader", () => {
  it("hands over the files of a disc that appears", async () => {
    const { state, loader, onFiles } = setup();
    await loader.checkNow();

    state.mounted = [mp3Disc];
    await loader.checkNow();

    expect(onFiles).toHaveBeenCalledExactlyOnceWith(["/Volumes/MP3/a.mp3"], mp3Disc);
    expect(loader.loaded).toEqual(mp3Disc);
  });

  it("does nothing while it isn't allowed to load, such as with an audio CD in the drive", async () => {
    const { state, loader, onFiles } = setup({ canLoad: () => false });
    state.mounted = [mp3Disc];

    await loader.checkNow();

    expect(onFiles).not.toHaveBeenCalled();
    expect(loader.loaded).toBeNull();
  });

  it("says when the loaded disc is ejected", async () => {
    const { state, loader, onRemoved } = setup();
    state.mounted = [mp3Disc];
    await loader.checkNow();

    state.mounted = [];
    await loader.checkNow();

    expect(onRemoved).toHaveBeenCalledExactlyOnceWith(mp3Disc);
    expect(loader.loaded).toBeNull();
  });

  it("ignores the ejecting of a disc it didn't load", async () => {
    const { state, loader, onRemoved } = setup({ files: [] });
    state.mounted = [otherDisc];
    await loader.checkNow();

    state.mounted = [];
    await loader.checkNow();

    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("loads each disc once per insertion", async () => {
    const { state, loader, onFiles } = setup();
    state.mounted = [mp3Disc];
    await loader.checkNow();

    state.mounted = [mp3Disc, otherDisc];
    await loader.checkNow();
    expect(onFiles).toHaveBeenCalledTimes(2);
    expect(onFiles.mock.calls[1][1]).toEqual(otherDisc);

    state.mounted = [];
    await loader.checkNow();
    state.mounted = [mp3Disc];
    await loader.checkNow();
    expect(onFiles).toHaveBeenCalledTimes(3);
  });
});
