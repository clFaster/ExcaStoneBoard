use std::fs;
use tauri::AppHandle;

use crate::db::get_boards_dir;

#[tauri::command]
pub(crate) fn get_system_test_export_path(app: AppHandle) -> Result<Option<String>, String> {
    resolve_system_test_transfer_path(&app, "TAURI_TEST_EXPORT_PATH")
}

#[tauri::command]
pub(crate) fn get_system_test_import_path(app: AppHandle) -> Result<Option<String>, String> {
    resolve_system_test_transfer_path(&app, "TAURI_TEST_IMPORT_PATH")
}

fn resolve_system_test_transfer_path(
    app: &AppHandle,
    env_key: &str,
) -> Result<Option<String>, String> {
    if !is_system_test_mode() {
        return Ok(None);
    }

    if let Some(path) = env_path_override(env_key) {
        return Ok(Some(path));
    }

    let directory = get_boards_dir(app)?.join("system-tests");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join("boards-transfer.json");
    Ok(Some(path.to_string_lossy().into_owned()))
}

fn is_system_test_mode() -> bool {
    matches!(
        std::env::var("TAURI_TEST_MODE").ok().as_deref(),
        Some("1" | "true" | "TRUE" | "True")
    )
}

fn env_path_override(env_key: &str) -> Option<String> {
    std::env::var(env_key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
