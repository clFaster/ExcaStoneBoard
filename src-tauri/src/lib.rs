mod commands;
mod db;
mod migrations;
mod models;

use crate::commands::boards::{
    create_board, delete_board, duplicate_board, export_boards, get_boards, import_boards,
    load_board_data, open_boards_folder, rename_board, save_board_data, set_active_board,
    set_boards_index, set_collaboration_link,
};
use tauri::{Emitter, Listener, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    builder
        .setup(|app| {
            // Handle deep links - when the app is opened via a URL
            #[cfg(desktop)]
            {
                let handle = app.handle().clone();
                app.listen("deep-link://new-url", move |event: tauri::Event| {
                    let urls = event.payload();
                    // Emit event to frontend
                    let _ = handle.emit("deep-link-received", urls);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_boards,
            create_board,
            rename_board,
            delete_board,
            set_active_board,
            save_board_data,
            load_board_data,
            set_collaboration_link,
            duplicate_board,
            set_boards_index,
            open_boards_folder,
            export_boards,
            import_boards
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
