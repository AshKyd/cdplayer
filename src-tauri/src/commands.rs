use crate::disc::{Toc, reader::DiscHandle};
use tauri::State;

/// Result of opening the drive at startup; kept so the frontend can see why there's no disc.
pub struct DiscState(pub Result<DiscHandle, String>);

#[tauri::command]
pub fn get_toc(state: State<DiscState>) -> Result<Toc, String> {
    state.0.as_ref().map(|disc| (*disc.toc).clone()).map_err(Clone::clone)
}
