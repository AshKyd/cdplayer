import { isAudioPath } from "$lib/files/audioFiles";
import { tauriFileSystem, type VolumeFileSystem } from "./fileSystem";
import { comparePaths, extensionOf, folderOf, isHidden, naturalCompare, normalisePath } from "./paths";
import { decodePlaylistBytes, parsePlaylist, PLAYLIST_EXTENSIONS, resolvePlaylistEntry } from "./playlist";

/** The first of `items` for which `load` finds something, or nothing. Tried one at a time, in order. */
const firstNonEmpty = async <Item>(items: Item[], load: (item: Item) => Promise<string[]>): Promise<string[]> => {
  const [head, ...rest] = items;
  if (head === undefined) return [];
  const found = await load(head);
  return found.length > 0 ? found : firstNonEmpty(rest, load);
};

/** The playable files a playlist lists, in its order. Entries that are missing, not audio or outside `root` are dropped. */
const readPlaylist = async (playlistPath: string, root: string, fs: VolumeFileSystem): Promise<string[]> => {
  const bytes = await fs.readFile(playlistPath).catch(() => null);
  if (!bytes) return [];
  const entries = parsePlaylist(decodePlaylistBytes(bytes), extensionOf(playlistPath));
  const resolved = entries
    .map((entry) => resolvePlaylistEntry(entry, folderOf(playlistPath), root))
    .filter((path): path is string => path !== null);
  const isPresent = await Promise.all(resolved.map((path) => fs.exists(path).catch(() => false)));
  return resolved.filter((_, index) => isPresent[index]);
};

/** Playlists directly in `root`: `.m3u` before `.m3u8` before `.pls`, then by name. */
const topLevelPlaylists = async (root: string, fs: VolumeFileSystem): Promise<string[]> => {
  const entries = await fs.readDir(root).catch(() => []);
  const rankOf = (name: string) => PLAYLIST_EXTENSIONS.indexOf(extensionOf(name));
  return entries
    .filter(({ name, isFile }) => isFile && !isHidden(name) && rankOf(name) !== -1)
    .sort((a, b) => rankOf(a.name) - rankOf(b.name) || naturalCompare(a.name, b.name))
    .map(({ name }) => `${root}/${name}`);
};

/** Every audio file under `folder`. Hidden files (macOS `._` copies included) are skipped, and symlinks aren't followed. */
const walkAudioFiles = async (folder: string, fs: VolumeFileSystem): Promise<string[]> => {
  const entries = await fs.readDir(folder).catch(() => []);
  const found = await Promise.all(
    entries
      .filter(({ name }) => !isHidden(name))
      .map(({ name, isDirectory, isFile }) => {
        const path = `${folder}/${name}`;
        if (isDirectory) return walkAudioFiles(path, fs);
        return Promise.resolve(isFile && isAudioPath(path) ? [path] : []);
      }),
  );
  return found.flat();
};

/**
 * The files to play from a mounted disc. A playlist in the top level of the disc decides the order; with none
 * (or none that lists a playable file) every audio file on the disc is returned, sorted by path. MP3 CDs rely on
 * file names for order because the order a disc lists its folders in is not guaranteed.
 */
export const listAudioFiles = async (mountPath: string, fs: VolumeFileSystem = tauriFileSystem): Promise<string[]> => {
  const root = normalisePath(mountPath);
  const playlists = await topLevelPlaylists(root, fs);
  const fromPlaylist = await firstNonEmpty(playlists, (playlist) => readPlaylist(playlist, root, fs));
  if (fromPlaylist.length > 0) return fromPlaylist;
  return (await walkAudioFiles(root, fs)).sort(comparePaths);
};
