use chrono::Utc;
use rusqlite::params;
use tauri::AppHandle;
use uuid::Uuid;

use crate::db::{
    board_exists, board_id_exists, default_board_data, first_board_id, first_board_id_from_db,
    get_board_by_id, get_setting, load_board_data_value, load_boards_index_from_db,
    normalize_active_board_id, open_db, set_setting,
};
use crate::models::{Board, BoardListItem, BoardsIndex};

const ACTIVE_BOARD_SETTING_KEY: &str = "active_board_id";

struct BoardDataPayload(String);

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

    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let board_data = BoardDataPayload(default_board_data());
    insert_board_with_data(&tx, &board, &board_data)?;

    tx.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![ACTIVE_BOARD_SETTING_KEY, board.id],
    )
    .map_err(|error| error.to_string())?;

    tx.commit().map_err(|error| error.to_string())?;
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
        .map_err(|error| error.to_string())?;
    if updated == 0 {
        return Err("Board not found".to_string());
    }
    get_board_by_id(&conn, &board_id)
}

#[tauri::command]
pub(crate) fn delete_board(app: AppHandle, board_id: String) -> Result<(), String> {
    let mut conn = open_db(&app)?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;

    tx.execute(
        "DELETE FROM board_data WHERE board_id = ?1",
        params![board_id],
    )
    .map_err(|error| error.to_string())?;
    let deleted = tx
        .execute("DELETE FROM boards WHERE id = ?1", params![board_id])
        .map_err(|error| error.to_string())?;
    if deleted == 0 {
        return Err("Board not found".to_string());
    }

    tx.execute(
        "DELETE FROM index_items WHERE item_type = 'board' AND item_id = ?1",
        params![board_id],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "DELETE FROM folder_items WHERE board_id = ?1",
        params![board_id],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "DELETE FROM folders WHERE id NOT IN (SELECT DISTINCT folder_id FROM folder_items)",
        [],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "DELETE FROM index_items WHERE item_type = 'folder' AND item_id NOT IN (SELECT id FROM folders)",
        [],
    )
    .map_err(|error| error.to_string())?;

    let active_id = get_setting(&tx, ACTIVE_BOARD_SETTING_KEY)?;
    if active_id.as_deref() == Some(&board_id) {
        let next_id = first_board_id_from_db(&tx)?;
        set_setting(&tx, ACTIVE_BOARD_SETTING_KEY, next_id.as_deref())?;
    }

    tx.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn set_active_board(app: AppHandle, board_id: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    if !board_id_exists(&conn, &board_id)? {
        return Err("Board not found".to_string());
    }
    set_setting(&conn, ACTIVE_BOARD_SETTING_KEY, Some(&board_id))?;
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
    let original_data = BoardDataPayload(
        load_board_data_value(&conn, &board_id)?.unwrap_or_else(default_board_data),
    );

    let now = Utc::now();
    let new_board = Board {
        id: Uuid::new_v4().to_string(),
        name: new_name,
        created_at: now,
        updated_at: now,
        collaboration_link: None,
        thumbnail: original.thumbnail.clone(),
    };

    let tx = conn.transaction().map_err(|error| error.to_string())?;
    insert_board_with_data(&tx, &new_board, &original_data)?;

    tx.commit().map_err(|error| error.to_string())?;
    Ok(new_board)
}

#[tauri::command]
pub(crate) fn set_boards_index(
    app: AppHandle,
    items: Vec<BoardListItem>,
) -> Result<BoardsIndex, String> {
    let mut conn = open_db(&app)?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;

    tx.execute("DELETE FROM index_items", [])
        .map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM folder_items", [])
        .map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM folders", [])
        .map_err(|error| error.to_string())?;

    for (position, item) in items.iter().enumerate() {
        match item {
            BoardListItem::Board(board) => {
                tx.execute(
                    "INSERT INTO index_items (position, item_type, item_id) VALUES (?1, 'board', ?2)",
                    params![position as i64, board.id],
                )
                .map_err(|error| error.to_string())?;
            }
            BoardListItem::Folder(folder) => {
                tx.execute(
                    "INSERT OR REPLACE INTO folders (id, name) VALUES (?1, ?2)",
                    params![folder.id, folder.name],
                )
                .map_err(|error| error.to_string())?;
                tx.execute(
                    "INSERT INTO index_items (position, item_type, item_id) VALUES (?1, 'folder', ?2)",
                    params![position as i64, folder.id],
                )
                .map_err(|error| error.to_string())?;
                for (folder_pos, board) in folder.items.iter().enumerate() {
                    tx.execute(
                        "INSERT INTO folder_items (folder_id, board_id, position) VALUES (?1, ?2, ?3)",
                        params![folder.id, board.id, folder_pos as i64],
                    )
                    .map_err(|error| error.to_string())?;
                }
            }
        }
    }

    let mut index = BoardsIndex {
        items,
        active_board_id: get_setting(&tx, ACTIVE_BOARD_SETTING_KEY)?,
    };

    if let Some(active_id) = index.active_board_id.clone() {
        if !board_exists(&index.items, &active_id) {
            index.active_board_id = first_board_id(&index.items);
        }
    } else {
        index.active_board_id = first_board_id(&index.items);
    }

    set_setting(
        &tx,
        ACTIVE_BOARD_SETTING_KEY,
        index.active_board_id.as_deref(),
    )?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(index)
}

fn insert_board_with_data(
    tx: &rusqlite::Transaction<'_>,
    board: &Board,
    data: &BoardDataPayload,
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
    .map_err(|error| error.to_string())?;

    tx.execute(
        "INSERT INTO board_data (board_id, data) VALUES (?1, ?2)",
        params![&board.id, &data.0],
    )
    .map_err(|error| error.to_string())?;

    let position = next_index_position(tx)?;
    tx.execute(
        "INSERT INTO index_items (position, item_type, item_id) VALUES (?1, 'board', ?2)",
        params![position, &board.id],
    )
    .map_err(|error| error.to_string())?;

    Ok(())
}

fn next_index_position(tx: &rusqlite::Transaction<'_>) -> Result<i64, String> {
    tx.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM index_items",
        [],
        |row| row.get(0),
    )
    .map_err(|error| error.to_string())
}
