/** A disc the system has mounted as a folder. Mirrors `OpticalVolume` in `src-tauri/src/volumes/optical.rs`. */
export interface OpticalVolume {
  /** Folder the disc's files are in. */
  mount_path: string;
  /** The disc's name. */
  label: string;
}
