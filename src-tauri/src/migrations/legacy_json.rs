use rusqlite::{params, Connection};
use serde::Deserialize;
use std::collections::HashSet;
use std::fs;
use tauri::AppHandle;

use crate::db::{
    board_exists, first_board_id, get_index_path, get_setting, insert_board_if_needed, set_setting,
};
use crate::models::{Board, BoardListItem, BoardsIndex};

#[derive(Debug, Deserialize)]
struct BoardsIndexLegacy {
    pub boards: Vec<Board>,
    pub active_board_id: Option<String>,
}

fn load_boards_index_from_json(app: &AppHandle) -> Result<BoardsIndex, String> {
    let index_path = get_index_path(app)?;
    if index_path.exists() {
        let content = fs::read_to_string(&index_path).map_err(|e| e.to_string())?;
        let value: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        if value.get("items").is_some() {
            serde_json::from_value(value).map_err(|e| e.to_string())
        } else if value.get("boards").is_some() {
            let legacy: BoardsIndexLegacy =
                serde_json::from_value(value).map_err(|e| e.to_string())?;
            Ok(BoardsIndex {
                items: legacy
                    .boards
                    .into_iter()
                    .map(BoardListItem::Board)
                    .collect(),
                active_board_id: legacy.active_board_id,
            })
        } else {
            Ok(BoardsIndex::default())
        }
    } else {
        Ok(BoardsIndex::default())
    }
}

pub(crate) fn migrate_legacy_json_if_needed(
    app: &AppHandle,
    conn: &mut Connection,
) -> Result<(), String> {
    let migrated = get_setting(conn, "legacy_json_migrated")?;
    if migrated.as_deref() == Some("1") {
        return Ok(());
    }

    let index_path = get_index_path(app)?;
    if !index_path.exists() {
        set_setting(conn, "legacy_json_migrated", Some("1"))?;
        return Ok(());
    }

    let has_data: i64 = conn
        .query_row("SELECT EXISTS(SELECT 1 FROM boards LIMIT 1)", [], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;
    if has_data != 0 {
        set_setting(conn, "legacy_json_migrated", Some("1"))?;
        return Ok(());
    }

    let index = load_boards_index_from_json(app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut inserted = HashSet::new();

    for (position, item) in index.items.iter().enumerate() {
        match item {
            BoardListItem::Board(board) => {
                insert_board_if_needed(&tx, app, &mut inserted, board)?;
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
                    insert_board_if_needed(&tx, app, &mut inserted, board)?;
                    tx.execute(
                        "INSERT INTO folder_items (folder_id, board_id, position) VALUES (?1, ?2, ?3)",
                        params![folder.id, board.id, folder_pos as i64],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
        }
    }

    let active_id = match index.active_board_id.clone() {
        Some(id) if board_exists(&index.items, &id) => Some(id),
        _ => first_board_id(&index.items),
    };

    if let Some(id) = active_id {
        tx.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('active_board_id', ?1)",
            params![id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        tx.execute("DELETE FROM settings WHERE key = 'active_board_id'", [])
            .map_err(|e| e.to_string())?;
    }

    tx.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('legacy_json_migrated', '1')",
        [],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
