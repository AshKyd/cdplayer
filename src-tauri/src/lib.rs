mod commands;
mod disc;
mod protocol;

use commands::DiscState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(DiscState(disc::reader::spawn_reader()?));
            Ok(())
        })
        // Each request blocks on the drive, so it's answered from its own thread.
        .register_asynchronous_uri_scheme_protocol("cd-track", |context, request, responder| {
            let disc_state = context.app_handle().state::<DiscState>();
            let disc = disc_state.0.clone();
            std::thread::spawn(move || {
                let uri = request.uri();
                responder.respond(protocol::respond(&disc, uri.path(), uri.query()));
            });
        })
        .invoke_handler(tauri::generate_handler![commands::get_toc])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
