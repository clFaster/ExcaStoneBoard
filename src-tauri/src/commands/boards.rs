use chrono::Utc;
use rusqlite::params;
use serde_json::Value as JsonValue;
use std::collections::HashSet;
use std::fs;
use tauri::AppHandle;
use uuid::Uuid;

use crate::db::{
    board_exists, board_id_exists, default_board_data, first_board_id, first_board_id_from_db,
    get_board_by_id, get_boards_dir, get_setting, load_board_data_value, load_boards_index_from_db,
    normalize_active_board_id, open_db, set_setting,
};
use crate::models::{
    Board, BoardListItem, BoardsExportEntry, BoardsExportFile, BoardsImportResult, BoardsIndex,
};

#[tauri::command]
pub(crate) fn get_boards(app: AppHandle) -> Result<BoardsIndex, String> {
    let conn = open_db(&app)?;
    let index = load_boards_index_from_db(&conn)?;
    normalize_active_board_id(&conn, index)
}

#[tauri::command]
pub(crate) fn create_board(app: AppHandle, name: String) -> Result<Board, String> {
    let mut conn = open_db(&app)?;
    let now = Utc::now();
    let board = Board {
        id: Uuid::new_v4().to_string(),
        name,
        created_at: now,
        updated_at: now,
        collaboration_link: None,
        thumbnail: None,
    };

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let board_data = default_board_data();
    insert_board_with_data(&tx, &board, &board_data)?;

    tx.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('active_board_id', ?1)",
        params![board.id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(board)
}

#[tauri::command]
pub(crate) fn rename_board(
    app: AppHandle,
    board_id: String,
    new_name: String,
) -> Result<Board, String> {
    let conn = open_db(&app)?;
    let now = Utc::now().timestamp_millis();
    let updated = conn
        .execute(
            "UPDATE boards SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![new_name, now, board_id],
        )
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err("Board not found".to_string());
    }
    get_board_by_id(&conn, &board_id)
}

#[tauri::command]
pub(crate) fn delete_board(app: AppHandle, board_id: String) -> Result<(), String> {
    let mut conn = open_db(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "DELETE FROM board_data WHERE board_id = ?1",
        params![board_id],
    )
    .map_err(|e| e.to_string())?;
    let deleted = tx
        .execute("DELETE FROM boards WHERE id = ?1", params![board_id])
        .map_err(|e| e.to_string())?;
    if deleted == 0 {
        return Err("Board not found".to_string());
    }

    tx.execute(
        "DELETE FROM index_items WHERE item_type = 'board' AND item_id = ?1",
        params![board_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM folder_items WHERE board_id = ?1",
        params![board_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM folders WHERE id NOT IN (SELECT DISTINCT folder_id FROM folder_items)",
        [],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM index_items WHERE item_type = 'folder' AND item_id NOT IN (SELECT id FROM folders)",
        [],
    )
    .map_err(|e| e.to_string())?;

    let active_id = get_setting(&tx, "active_board_id")?;
    if active_id.as_deref() == Some(&board_id) {
        let next_id = first_board_id_from_db(&tx)?;
        set_setting(&tx, "active_board_id", next_id.as_deref())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn set_active_board(app: AppHandle, board_id: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    if !board_id_exists(&conn, &board_id)? {
        return Err("Board not found".to_string());
    }
    set_setting(&conn, "active_board_id", Some(&board_id))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn save_board_data(
    app: AppHandle,
    board_id: String,
    data: String,
) -> Result<(), String> {
    let mut conn = open_db(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let updated = tx
        .execute(
            "UPDATE boards SET updated_at = ?1 WHERE id = ?2",
            params![Utc::now().timestamp_millis(), board_id],
        )
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err("Board not found".to_string());
    }

    tx.execute(
        "INSERT OR REPLACE INTO board_data (board_id, data) VALUES (?1, ?2)",
        params![board_id, data],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
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
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err("Board not found".to_string());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn duplicate_board(
    app: AppHandle,
    board_id: String,
    new_name: String,
) -> Result<Board, String> {
    let mut conn = open_db(&app)?;
    let original = get_board_by_id(&conn, &board_id)?;
    let original_data = load_board_data_value(&conn, &board_id)?.unwrap_or_else(default_board_data);

    let now = Utc::now();
    let new_board = Board {
        id: Uuid::new_v4().to_string(),
        name: new_name,
        created_at: now,
        updated_at: now,
        collaboration_link: None,
        thumbnail: original.thumbnail.clone(),
    };

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    insert_board_with_data(&tx, &new_board, &original_data)?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(new_board)
}

#[tauri::command]
pub(crate) fn set_boards_index(
    app: AppHandle,
    items: Vec<BoardListItem>,
) -> Result<BoardsIndex, String> {
    let mut conn = open_db(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM index_items", [])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM folder_items", [])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM folders", [])
        .map_err(|e| e.to_string())?;

    for (position, item) in items.iter().enumerate() {
        match item {
            BoardListItem::Board(board) => {
                tx.execute(
                    "INSERT INTO index_items (position, item_type, item_id) VALUES (?1, 'board', ?2)",
                    params![position as i64, board.id],
                )
                .map_err(|e| e.to_string())?;
            }
            BoardListItem::Folder(folder) => {
                tx.execute(
                    "INSERT OR REPLACE INTO folders (id, name) VALUES (?1, ?2)",
                    params![folder.id, folder.name],
                )
                .map_err(|e| e.to_string())?;
                tx.execute(
                    "INSERT INTO index_items (position, item_type, item_id) VALUES (?1, 'folder', ?2)",
                    params![position as i64, folder.id],
                )
                .map_err(|e| e.to_string())?;
                for (folder_pos, board) in folder.items.iter().enumerate() {
                    tx.execute(
                        "INSERT INTO folder_items (folder_id, board_id, position) VALUES (?1, ?2, ?3)",
                        params![folder.id, board.id, folder_pos as i64],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
        }
    }

    let mut index = BoardsIndex {
        items,
        active_board_id: get_setting(&tx, "active_board_id")?,
    };

    if let Some(active_id) = index.active_board_id.clone() {
        if !board_exists(&index.items, &active_id) {
            index.active_board_id = first_board_id(&index.items);
        }
    } else {
        index.active_board_id = first_board_id(&index.items);
    }

    set_setting(&tx, "active_board_id", index.active_board_id.as_deref())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(index)
}

#[tauri::command]
pub(crate) fn export_boards(app: AppHandle, file_path: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    let index = load_boards_index_from_db(&conn)?;

    let mut boards = Vec::new();
    let mut seen = HashSet::new();

    for item in index.items.iter() {
        match item {
            BoardListItem::Board(board) => {
                if seen.insert(board.id.clone()) {
                    boards.push(build_export_entry(&conn, board)?);
                }
            }
            BoardListItem::Folder(folder) => {
                for board in folder.items.iter() {
                    if seen.insert(board.id.clone()) {
                        boards.push(build_export_entry(&conn, board)?);
                    }
                }
            }
        }
    }

    let export_file = BoardsExportFile {
        version: 1,
        exported_at: Utc::now(),
        boards,
    };

    let payload = serde_json::to_string_pretty(&export_file).map_err(|e| e.to_string())?;
    fs::write(file_path, payload).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn import_boards(
    app: AppHandle,
    file_path: String,
    selected_indices: Vec<usize>,
) -> Result<BoardsImportResult, String> {
    let payload = fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    let export_file: BoardsExportFile =
        serde_json::from_str(&payload).map_err(|e| e.to_string())?;

    let conn = open_db(&app)?;
    let active_before = get_setting(&conn, "active_board_id")?;

    let (existing_ids, mut used_names) = load_existing_board_ids_and_names(&conn)?;
    let selected: HashSet<usize> = selected_indices.into_iter().collect();
    let mut seen_ids = existing_ids;
    let mut imported = 0;
    let mut skipped = 0;

    for (index, entry) in export_file.boards.iter().enumerate() {
        if !selected.contains(&index) {
            continue;
        }

        let final_name = resolve_import_name(entry, &seen_ids, &used_names);

        let created = match create_board(app.clone(), final_name.clone()) {
            Ok(board) => board,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };

        if let Some(data_value) = entry.data.clone() {
            if !data_value.is_null() {
                let data_str = data_value.to_string();
                save_board_data(app.clone(), created.id.clone(), data_str)?;
            }
        }

        register_imported_identity(entry, &final_name, &mut seen_ids, &mut used_names);
        imported += 1;
    }

    restore_active_board(&conn, active_before)?;

    Ok(BoardsImportResult { imported, skipped })
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
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err("Board not found".to_string());
    }
    Ok(())
}

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
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
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

fn insert_board_with_data(
    tx: &rusqlite::Transaction<'_>,
    board: &Board,
    data: &str,
) -> Result<(), String> {
    tx.execute(
        "INSERT INTO boards (id, name, created_at, updated_at, collaboration_link, thumbnail)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            &board.id,
            &board.name,
            board.created_at.timestamp_millis(),
            board.updated_at.timestamp_millis(),
            &board.collaboration_link,
            &board.thumbnail
        ],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO board_data (board_id, data) VALUES (?1, ?2)",
        params![&board.id, data],
    )
    .map_err(|e| e.to_string())?;

    let position = next_index_position(tx)?;
    tx.execute(
        "INSERT INTO index_items (position, item_type, item_id) VALUES (?1, 'board', ?2)",
        params![position, &board.id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn next_index_position(tx: &rusqlite::Transaction<'_>) -> Result<i64, String> {
    tx.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM index_items",
        [],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn load_existing_board_ids_and_names(
    conn: &rusqlite::Connection,
) -> Result<(HashSet<String>, HashSet<String>), String> {
    let mut stmt = conn
        .prepare("SELECT id, name FROM boards")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    let mut ids = HashSet::new();
    let mut used_names = HashSet::new();

    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let id: String = row.get(0).map_err(|e| e.to_string())?;
        let name: String = row.get(1).map_err(|e| e.to_string())?;

        ids.insert(id);
        let name_key = name.trim().to_lowercase();
        if !name_key.is_empty() {
            used_names.insert(name_key);
        }
    }

    Ok((ids, used_names))
}

fn normalize_import_name(name: &str) -> String {
    if name.trim().is_empty() {
        "Imported board".to_string()
    } else {
        name.trim().to_string()
    }
}

fn make_copy_name(base: &str, used_names: &HashSet<String>) -> String {
    let mut candidate = format!("{} (Copy)", base);
    let mut counter = 2;
    while used_names.contains(&candidate.to_lowercase()) {
        candidate = format!("{} (Copy {})", base, counter);
        counter += 1;
    }
    candidate
}

fn resolve_import_name(
    entry: &BoardsExportEntry,
    seen_ids: &HashSet<String>,
    used_names: &HashSet<String>,
) -> String {
    let base_name = normalize_import_name(&entry.name);
    let has_id = !entry.id.trim().is_empty();
    let is_duplicate = has_id && seen_ids.contains(&entry.id);
    if is_duplicate {
        make_copy_name(&base_name, used_names)
    } else {
        base_name
    }
}

fn register_imported_identity(
    entry: &BoardsExportEntry,
    final_name: &str,
    seen_ids: &mut HashSet<String>,
    used_names: &mut HashSet<String>,
) {
    let has_id = !entry.id.trim().is_empty();
    used_names.insert(final_name.to_lowercase());
    if has_id {
        seen_ids.insert(entry.id.clone());
    }
}

fn restore_active_board(
    conn: &rusqlite::Connection,
    active_before: Option<String>,
) -> Result<(), String> {
    if let Some(active_id) = active_before {
        set_setting(conn, "active_board_id", Some(&active_id))?;
    }
    Ok(())
}

fn build_export_entry(
    conn: &rusqlite::Connection,
    board: &Board,
) -> Result<BoardsExportEntry, String> {
    let data_str = load_board_data_value(conn, &board.id)?.unwrap_or_else(default_board_data);
    let data_json: JsonValue = serde_json::from_str(&data_str).unwrap_or(JsonValue::Null);

    Ok(BoardsExportEntry {
        id: board.id.clone(),
        name: board.name.clone(),
        created_at: board.created_at,
        updated_at: board.updated_at,
        collaboration_link: board.collaboration_link.clone(),
        thumbnail: board.thumbnail.clone(),
        data: Some(data_json),
    })
}
