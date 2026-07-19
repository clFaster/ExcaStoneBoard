use chrono::Utc;
use rusqlite::params;
use tauri::AppHandle;
use uuid::Uuid;

use crate::db::{
    board_exists, board_id_exists, default_board_data, first_board_id, first_board_id_from_db,
    get_board_by_id, get_setting, load_board_data_value, load_boards_index_from_db,
    normalize_active_board_id, open_db, set_setting,
};
use crate::models::{Board, BoardFolder, BoardListItem, BoardMutationResult, BoardsIndex};
use crate::thumbnails;

const ACTIVE_BOARD_SETTING_KEY: &str = "active_board_id";

struct BoardDataPayload(String);

#[tauri::command]
pub(crate) fn get_boards(app: AppHandle) -> Result<BoardsIndex, String> {
    let conn = open_db(&app)?;
    load_resolved_boards_index(&app, &conn)
}

#[tauri::command]
pub(crate) fn create_board(app: AppHandle, name: String) -> Result<BoardMutationResult, String> {
    let mut conn = open_db(&app)?;
    let board = insert_new_board(&mut conn, name)?;
    build_mutation_result(&app, &conn, &board.id)
}

pub(crate) fn create_board_record(app: &AppHandle, name: String) -> Result<Board, String> {
    let mut conn = open_db(&app)?;
    insert_new_board(&mut conn, name)
}

fn insert_new_board(conn: &mut rusqlite::Connection, name: String) -> Result<Board, String> {
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
    let board = get_board_by_id(&conn, &board_id)?;
    resolve_board_thumbnail(&app, board)
}

#[tauri::command]
pub(crate) fn delete_board(app: AppHandle, board_id: String) -> Result<BoardsIndex, String> {
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
    thumbnails::delete_thumbnail(&app, thumbnails::BoardId::from(board_id.as_str()))?;

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
    load_resolved_boards_index(&app, &conn)
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
) -> Result<BoardMutationResult, String> {
    let mut conn = open_db(&app)?;
    let _original = get_board_by_id(&conn, &board_id)?;
    let original_data = BoardDataPayload(
        load_board_data_value(&conn, &board_id)?.unwrap_or_else(default_board_data),
    );

    let now = Utc::now();
    let new_id = Uuid::new_v4().to_string();
    let copied_thumbnail = thumbnails::copy_thumbnail(
        &app,
        thumbnails::BoardId::from(board_id.as_str()),
        thumbnails::BoardId::from(new_id.as_str()),
    )?;
    let new_board = Board {
        id: new_id,
        name: new_name,
        created_at: now,
        updated_at: now,
        collaboration_link: None,
        thumbnail: copied_thumbnail,
    };

    let tx = conn.transaction().map_err(|error| error.to_string())?;
    insert_board_with_data(&tx, &new_board, &original_data)?;

    tx.commit().map_err(|error| error.to_string())?;
    build_mutation_result(&app, &conn, &new_board.id)
}

#[tauri::command]
pub(crate) fn set_boards_index(
    app: AppHandle,
    items: Vec<BoardListItem>,
) -> Result<BoardsIndex, String> {
    let mut conn = open_db(&app)?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;

    clear_index_tables(&tx)?;

    for (position, item) in items.iter().enumerate() {
        persist_index_item(&tx, position as i64, item)?;
    }

    let active_board_id = get_setting(&tx, ACTIVE_BOARD_SETTING_KEY)?;
    let normalized_active_board_id = resolve_active_board_id(&items, active_board_id);
    let index = BoardsIndex {
        items,
        active_board_id: normalized_active_board_id,
    };

    set_setting(
        &tx,
        ACTIVE_BOARD_SETTING_KEY,
        index.active_board_id.as_deref(),
    )?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(index)
}

fn clear_index_tables(tx: &rusqlite::Transaction<'_>) -> Result<(), String> {
    tx.execute("DELETE FROM index_items", [])
        .map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM folder_items", [])
        .map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM folders", [])
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn persist_index_item(
    tx: &rusqlite::Transaction<'_>,
    position: i64,
    item: &BoardListItem,
) -> Result<(), String> {
    match item {
        BoardListItem::Board(board) => {
            tx.execute(
                "INSERT INTO index_items (position, item_type, item_id) VALUES (?1, 'board', ?2)",
                params![position, &board.id],
            )
            .map_err(|error| error.to_string())?;
            Ok(())
        }
        BoardListItem::Folder(folder) => persist_folder_item(tx, position, folder),
    }
}

fn persist_folder_item(
    tx: &rusqlite::Transaction<'_>,
    position: i64,
    folder: &crate::models::BoardFolder,
) -> Result<(), String> {
    tx.execute(
        "INSERT OR REPLACE INTO folders (id, name) VALUES (?1, ?2)",
        params![&folder.id, &folder.name],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "INSERT INTO index_items (position, item_type, item_id) VALUES (?1, 'folder', ?2)",
        params![position, &folder.id],
    )
    .map_err(|error| error.to_string())?;

    for (folder_position, board) in folder.items.iter().enumerate() {
        tx.execute(
            "INSERT INTO folder_items (folder_id, board_id, position) VALUES (?1, ?2, ?3)",
            params![&folder.id, &board.id, folder_position as i64],
        )
        .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn resolve_active_board_id(
    items: &[BoardListItem],
    active_board_id: Option<String>,
) -> Option<String> {
    match active_board_id {
        Some(active_id) if board_exists(items, &active_id) => Some(active_id),
        _ => first_board_id(items),
    }
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

fn load_resolved_boards_index(
    app: &AppHandle,
    conn: &rusqlite::Connection,
) -> Result<BoardsIndex, String> {
    let index = load_boards_index_from_db(conn)?;
    let index = normalize_active_board_id(conn, index)?;
    resolve_index_thumbnails(app, index)
}

fn build_mutation_result(
    app: &AppHandle,
    conn: &rusqlite::Connection,
    board_id: &str,
) -> Result<BoardMutationResult, String> {
    let index = load_resolved_boards_index(app, conn)?;
    let board = find_board_in_index(&index.items, board_id)
        .cloned()
        .ok_or_else(|| "Created board missing from index".to_string())?;
    Ok(BoardMutationResult { board, index })
}

fn find_board_in_index<'a>(items: &'a [BoardListItem], board_id: &str) -> Option<&'a Board> {
    items.iter().find_map(|item| match item {
        BoardListItem::Board(board) if board.id == board_id => Some(board),
        BoardListItem::Folder(folder) => folder.items.iter().find(|board| board.id == board_id),
        BoardListItem::Board(_) => None,
    })
}

/// Converts a board's `thumbnail` field from a relative file path (as stored in the DB)
/// into a data URL suitable for the frontend.
fn resolve_board_thumbnail(app: &AppHandle, mut board: Board) -> Result<Board, String> {
    board.thumbnail = thumbnails::load_thumbnail_data_url(
        app,
        board
            .thumbnail
            .as_deref()
            .map(thumbnails::RelativeThumbnailPath::from),
    )?;
    Ok(board)
}

fn resolve_index_thumbnails(
    app: &AppHandle,
    mut index: BoardsIndex,
) -> Result<BoardsIndex, String> {
    let mut resolved_items = Vec::with_capacity(index.items.len());
    for item in index.items.drain(..) {
        resolved_items.push(resolve_item_thumbnails(app, item)?);
    }
    index.items = resolved_items;
    Ok(index)
}

fn resolve_item_thumbnails(app: &AppHandle, item: BoardListItem) -> Result<BoardListItem, String> {
    match item {
        BoardListItem::Board(board) => {
            Ok(BoardListItem::Board(resolve_board_thumbnail(app, board)?))
        }
        BoardListItem::Folder(folder) => {
            let BoardFolder { id, name, items } = folder;
            let mut resolved_boards = Vec::with_capacity(items.len());
            for board in items {
                resolved_boards.push(resolve_board_thumbnail(app, board)?);
            }
            Ok(BoardListItem::Folder(BoardFolder {
                id,
                name,
                items: resolved_boards,
            }))
        }
    }
}
