mod commands;
mod disc;
mod files;
mod protocol;

use commands::DiscState;
use files::FileRegistry;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(DiscState(disc::reader::spawn_reader()?));
            app.manage(FileRegistry::default());
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
        // Decoding a chunk takes a moment, so these too are answered from their own threads.
        .register_asynchronous_uri_scheme_protocol("file-track", |context, request, responder| {
            let registry = context.app_handle().state::<FileRegistry>().inner().clone();
            std::thread::spawn(move || {
                let uri = request.uri();
                responder.respond(files::protocol::respond(&registry, uri.path(), uri.query()));
            });
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_toc,
            commands::open_audio_file,
            commands::close_audio_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
