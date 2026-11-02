import { exists, readDir, readFile } from "@tauri-apps/plugin-fs";

export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

/**
 * The reading of a mounted disc's folders and playlists. The real one is the Tauri fs plugin, which is only
 * allowed to see discs that `list_optical_volumes` has returned; tests pass a fake.
 */
export interface VolumeFileSystem {
  readDir(path: string): Promise<DirectoryEntry[]>;
  readFile(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
}

export const tauriFileSystem: VolumeFileSystem = { readDir, readFile, exists };
