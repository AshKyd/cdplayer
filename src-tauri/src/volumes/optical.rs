//! Finds optical discs the operating system has mounted as folders (data and MP3 CDs, DVDs).
//! Audio CDs are not listed: they are read sector by sector through `disc`.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OpticalVolume {
    /// Folder the disc's files are in.
    pub mount_path: String,
    /// The disc's name; the last part of the mount path where the system doesn't say.
    pub label: String,
}

/// File systems that discs are mounted with. `cddafs` (macOS audio CDs) is left out on purpose.
const OPTICAL_FILE_SYSTEMS: [&str; 2] = ["iso9660", "udf"];

fn volume_at(mount_path: &str) -> OpticalVolume {
    let label = mount_path.rsplit(['/', '\\']).find(|part| !part.is_empty()).unwrap_or(mount_path);
    OpticalVolume { mount_path: mount_path.to_string(), label: label.to_string() }
}

/// Lines of macOS `mount`: `/dev/disk4 on /Volumes/My Disc (cd9660, local, nodev, nosuid, read-only, noowners)`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_mount_output(output: &str) -> Vec<OpticalVolume> {
    output
        .lines()
        .filter_map(|line| {
            let (_, rest) = line.split_once(" on ")?;
            let (mount_path, options) = rest.rsplit_once(" (")?;
            let file_system = options.split(',').next()?.trim();
            // macOS calls ISO 9660 `cd9660`.
            let is_optical = file_system == "cd9660" || OPTICAL_FILE_SYSTEMS.contains(&file_system);
            is_optical.then(|| volume_at(mount_path))
        })
        .collect()
}

/// Lines of Linux `/proc/mounts`: `/dev/sr0 /media/ash/MY\040DISC iso9660 ro,nosuid 0 0`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_proc_mounts(contents: &str) -> Vec<OpticalVolume> {
    contents
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let (_device, mount_path, file_system) = (fields.next()?, fields.next()?, fields.next()?);
            OPTICAL_FILE_SYSTEMS.contains(&file_system).then(|| volume_at(&unescape_octal(mount_path)))
        })
        .collect()
}

/// `/proc/mounts` writes spaces and other awkward characters as `\040`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn unescape_octal(field: &str) -> String {
    let bytes = field.as_bytes();
    let mut unescaped = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let octal = bytes.get(index + 1..index + 4).and_then(|digits| std::str::from_utf8(digits).ok());
        match (bytes[index], octal.and_then(|digits| u8::from_str_radix(digits, 8).ok())) {
            (b'\\', Some(byte)) => {
                unescaped.push(byte);
                index += 4;
            }
            (byte, _) => {
                unescaped.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&unescaped).into_owned()
}

#[cfg(target_os = "macos")]
pub fn list_optical_volumes() -> Vec<OpticalVolume> {
    std::process::Command::new("/sbin/mount")
        .output()
        .map(|output| parse_mount_output(&String::from_utf8_lossy(&output.stdout)))
        .unwrap_or_default()
}

#[cfg(target_os = "linux")]
pub fn list_optical_volumes() -> Vec<OpticalVolume> {
    std::fs::read_to_string("/proc/mounts").map(|contents| parse_proc_mounts(&contents)).unwrap_or_default()
}

#[cfg(windows)]
pub fn list_optical_volumes() -> Vec<OpticalVolume> {
    use std::os::windows::ffi::OsStrExt;

    const DRIVE_CDROM: u32 = 5;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetLogicalDrives() -> u32;
        fn GetDriveTypeW(root_path_name: *const u16) -> u32;
        fn GetVolumeInformationW(
            root_path_name: *const u16,
            volume_name_buffer: *mut u16,
            volume_name_size: u32,
            volume_serial_number: *mut u32,
            maximum_component_length: *mut u32,
            file_system_flags: *mut u32,
            file_system_name_buffer: *mut u16,
            file_system_name_size: u32,
        ) -> i32;
    }

    // Bit n of the mask is drive letter n; an empty drive has no volume information, so it's skipped.
    let drive_mask = unsafe { GetLogicalDrives() };
    (0..26u8)
        .filter(|bit| drive_mask & (1 << bit) != 0)
        .filter_map(|bit| {
            let root = format!("{}:\\", (b'A' + bit) as char);
            let wide_root: Vec<u16> = std::ffi::OsStr::new(&root).encode_wide().chain(Some(0)).collect();
            if unsafe { GetDriveTypeW(wide_root.as_ptr()) } != DRIVE_CDROM {
                return None;
            }
            let mut name = [0u16; 261];
            let has_disc = unsafe {
                GetVolumeInformationW(
                    wide_root.as_ptr(),
                    name.as_mut_ptr(),
                    name.len() as u32,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    0,
                )
            } != 0;
            if !has_disc {
                return None;
            }
            let name_length = name.iter().position(|unit| *unit == 0).unwrap_or(name.len());
            let name = String::from_utf16_lossy(&name[..name_length]);
            Some(OpticalVolume { label: if name.is_empty() { root.clone() } else { name }, mount_path: root })
        })
        .collect()
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
pub fn list_optical_volumes() -> Vec<OpticalVolume> {
    vec![]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_mount_lines_keep_only_discs() {
        let output = "\
/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)
/dev/disk4 on /Volumes/My Disc (cd9660, local, nodev, nosuid, read-only, noowners)
/dev/disk5 on /Volumes/Movie (udf, local, nodev, nosuid, read-only, noowners)
/dev/disk6 on /Volumes/Audio CD (cddafs, local, nodev, nosuid, read-only, noowners)
";
        assert_eq!(
            parse_mount_output(output),
            [
                OpticalVolume { mount_path: "/Volumes/My Disc".into(), label: "My Disc".into() },
                OpticalVolume { mount_path: "/Volumes/Movie".into(), label: "Movie".into() },
            ]
        );
    }

    #[test]
    fn linux_mounts_unescape_spaces() {
        let contents = "\
/dev/nvme0n1p2 / ext4 rw 0 0
/dev/sr0 /media/ash/MY\\040DISC iso9660 ro,nosuid 0 0
";
        assert_eq!(
            parse_proc_mounts(contents),
            [OpticalVolume { mount_path: "/media/ash/MY DISC".into(), label: "MY DISC".into() }]
        );
    }
}
