use chrono::Utc;
use serde_json::Value as JsonValue;
use std::collections::HashSet;
use std::fs;
use tauri::AppHandle;

use crate::commands::board_content::save_board_data;
use crate::commands::boards::create_board;
use crate::db::{
    default_board_data, get_setting, load_board_data_value, load_boards_index_from_db, open_db,
    set_setting,
};
use crate::models::{
    Board, BoardListItem, BoardsExportEntry, BoardsExportFile, BoardsImportResult,
};

const ACTIVE_BOARD_SETTING_KEY: &str = "active_board_id";

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

    let payload = serde_json::to_string_pretty(&export_file).map_err(|error| error.to_string())?;
    fs::write(file_path, payload).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn import_boards(
    app: AppHandle,
    file_path: String,
    selected_indices: Vec<usize>,
) -> Result<BoardsImportResult, String> {
    let payload = fs::read_to_string(file_path).map_err(|error| error.to_string())?;
    let export_file: BoardsExportFile =
        serde_json::from_str(&payload).map_err(|error| error.to_string())?;

    let conn = open_db(&app)?;
    let active_before = get_setting(&conn, ACTIVE_BOARD_SETTING_KEY)?;

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

fn load_existing_board_ids_and_names(
    conn: &rusqlite::Connection,
) -> Result<(HashSet<String>, HashSet<String>), String> {
    let mut stmt = conn
        .prepare("SELECT id, name FROM boards")
        .map_err(|error| error.to_string())?;
    let mut rows = stmt.query([]).map_err(|error| error.to_string())?;
    let mut ids = HashSet::new();
    let mut used_names = HashSet::new();

    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let id: String = row.get(0).map_err(|error| error.to_string())?;
        let name: String = row.get(1).map_err(|error| error.to_string())?;

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
        set_setting(conn, ACTIVE_BOARD_SETTING_KEY, Some(&active_id))?;
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
