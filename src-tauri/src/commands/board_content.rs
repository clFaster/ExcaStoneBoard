use chrono::Utc;
use rusqlite::params;
use tauri::AppHandle;

use crate::db::{board_id_exists, default_board_data, load_board_data_value, open_db};

#[tauri::command]
pub(crate) fn save_board_data(
    app: AppHandle,
    board_id: String,
    data: String,
) -> Result<(), String> {
    let mut conn = open_db(&app)?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;

    let updated = tx
        .execute(
            "UPDATE boards SET updated_at = ?1 WHERE id = ?2",
            params![Utc::now().timestamp_millis(), board_id],
        )
        .map_err(|error| error.to_string())?;
    if updated == 0 {
        return Err("Board not found".to_string());
    }

    tx.execute(
        "INSERT OR REPLACE INTO board_data (board_id, data) VALUES (?1, ?2)",
        params![board_id, data],
    )
    .map_err(|error| error.to_string())?;

    tx.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn load_board_data(app: AppHandle, board_id: String) -> Result<String, String> {
    let conn = open_db(&app)?;
    if let Some(data) = load_board_data_value(&conn, &board_id)? {
        return Ok(data);
    }
    if !board_id_exists(&conn, &board_id)? {
        return Err("Board not found".to_string());
    }
    Ok(default_board_data())
}

#[tauri::command]
pub(crate) fn set_collaboration_link(
    app: AppHandle,
    board_id: String,
    link: Option<String>,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    let updated = conn
        .execute(
            "UPDATE boards SET collaboration_link = ?1, updated_at = ?2 WHERE id = ?3",
            params![link, Utc::now().timestamp_millis(), board_id],
        )
        .map_err(|error| error.to_string())?;
    if updated == 0 {
        return Err("Board not found".to_string());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn save_board_thumbnail(
    app: AppHandle,
    board_id: String,
    thumbnail: Option<String>,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    let updated = conn
        .execute(
            "UPDATE boards SET thumbnail = ?1 WHERE id = ?2",
            params![thumbnail, board_id],
        )
        .map_err(|error| error.to_string())?;
    if updated == 0 {
        return Err("Board not found".to_string());
    }
    Ok(())
}
