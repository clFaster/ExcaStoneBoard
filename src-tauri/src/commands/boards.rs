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
    tx.execute(
        "INSERT INTO boards (id, name, created_at, updated_at, collaboration_link, thumbnail)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            board.id,
            board.name,
            board.created_at.timestamp_millis(),
            board.updated_at.timestamp_millis(),
            board.collaboration_link,
            board.thumbnail
        ],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO board_data (board_id, data) VALUES (?1, ?2)",
        params![board.id, default_board_data()],
    )
    .map_err(|e| e.to_string())?;

    let position: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM index_items",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO index_items (position, item_type, item_id) VALUES (?1, 'board', ?2)",
        params![position, board.id],
    )
    .map_err(|e| e.to_string())?;

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
    tx.execute(
        "INSERT INTO boards (id, name, created_at, updated_at, collaboration_link, thumbnail)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            new_board.id,
            new_board.name,
            new_board.created_at.timestamp_millis(),
            new_board.updated_at.timestamp_millis(),
            new_board.collaboration_link,
            new_board.thumbnail
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO board_data (board_id, data) VALUES (?1, ?2)",
        params![new_board.id, original_data],
    )
    .map_err(|e| e.to_string())?;

    let position: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM index_items",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO index_items (position, item_type, item_id) VALUES (?1, 'board', ?2)",
        params![position, new_board.id],
    )
    .map_err(|e| e.to_string())?;

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
