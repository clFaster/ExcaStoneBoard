use chrono::{DateTime, TimeZone, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::migrations::legacy_json::migrate_legacy_json_if_needed;
use crate::models::{Board, BoardFolder, BoardListItem, BoardsIndex};

pub(crate) fn get_boards_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let boards_dir = app_data.join("boards");
    fs::create_dir_all(&boards_dir).map_err(|e| e.to_string())?;
    Ok(boards_dir)
}

pub(crate) fn get_index_path(app: &AppHandle) -> Result<PathBuf, String> {
    let boards_dir = get_boards_dir(app)?;
    Ok(boards_dir.join("index.json"))
}

fn get_board_data_path(app: &AppHandle, board_id: &str) -> Result<PathBuf, String> {
    let boards_dir = get_boards_dir(app)?;
    Ok(boards_dir.join(format!("{}.json", board_id)))
}

pub(crate) fn default_board_data() -> String {
    serde_json::json!({
        "excalidraw": null,
        "excalidraw-state": null
    })
    .to_string()
}

fn get_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let boards_dir = get_boards_dir(app)?;
    Ok(boards_dir.join("boards.db"))
}

pub(crate) fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let db_path = get_db_path(app)?;
    let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| e.to_string())?;
    init_db(&conn)?;
    migrate_legacy_json_if_needed(app, &mut conn)?;
    Ok(conn)
}

fn init_db(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS boards (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            collaboration_link TEXT,
            thumbnail TEXT
        );
        CREATE TABLE IF NOT EXISTS folders (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS index_items (
            position INTEGER NOT NULL,
            item_type TEXT NOT NULL,
            item_id TEXT NOT NULL,
            PRIMARY KEY(position)
        );
        CREATE TABLE IF NOT EXISTS folder_items (
            folder_id TEXT NOT NULL,
            board_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            PRIMARY KEY(folder_id, position),
            UNIQUE(folder_id, board_id),
            FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE CASCADE,
            FOREIGN KEY(board_id) REFERENCES boards(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS board_data (
            board_id TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            FOREIGN KEY(board_id) REFERENCES boards(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
    )
    .map_err(|e| e.to_string())?;

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if version == 0 {
        conn.execute("PRAGMA user_version = 1", [])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub(crate) fn set_setting(conn: &Connection, key: &str, value: Option<&str>) -> Result<(), String> {
    if let Some(value) = value {
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute("DELETE FROM settings WHERE key = ?1", params![key])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn datetime_from_millis(value: i64) -> Result<DateTime<Utc>, String> {
    Utc.timestamp_millis_opt(value)
        .single()
        .ok_or_else(|| "Invalid timestamp in database".to_string())
}

pub(crate) fn board_id_exists(conn: &Connection, board_id: &str) -> Result<bool, String> {
    let exists: i64 = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM boards WHERE id = ?1)",
            params![board_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(exists != 0)
}

pub(crate) fn first_board_id_from_db(conn: &Connection) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare("SELECT item_type, item_id FROM index_items ORDER BY position ASC")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;

    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let item_type: String = row.get(0).map_err(|e| e.to_string())?;
        let item_id: String = row.get(1).map_err(|e| e.to_string())?;
        if item_type == "board" {
            return Ok(Some(item_id));
        }
        if item_type == "folder" {
            let board_id: Option<String> = conn
                .query_row(
                    "SELECT board_id FROM folder_items WHERE folder_id = ?1 ORDER BY position ASC LIMIT 1",
                    params![item_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if board_id.is_some() {
                return Ok(board_id);
            }
        }
    }

    Ok(None)
}

fn load_folder_boards(
    conn: &Connection,
    folder_id: &str,
    boards: &HashMap<String, Board>,
) -> Result<Vec<Board>, String> {
    let mut stmt = conn
        .prepare("SELECT board_id FROM folder_items WHERE folder_id = ?1 ORDER BY position ASC")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![folder_id]).map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let board_id: String = row.get(0).map_err(|e| e.to_string())?;
        if let Some(board) = boards.get(&board_id) {
            items.push(board.clone());
        }
    }

    Ok(items)
}

pub(crate) fn load_boards_index_from_db(conn: &Connection) -> Result<BoardsIndex, String> {
    let mut boards = HashMap::new();
    let mut stmt = conn
        .prepare(
            "SELECT id, name, created_at, updated_at, collaboration_link, thumbnail FROM boards",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;

    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let created_at_ms: i64 = row.get(2).map_err(|e| e.to_string())?;
        let updated_at_ms: i64 = row.get(3).map_err(|e| e.to_string())?;
        let board = Board {
            id: row.get(0).map_err(|e| e.to_string())?,
            name: row.get(1).map_err(|e| e.to_string())?,
            created_at: datetime_from_millis(created_at_ms)?,
            updated_at: datetime_from_millis(updated_at_ms)?,
            collaboration_link: row.get(4).map_err(|e| e.to_string())?,
            thumbnail: row.get(5).map_err(|e| e.to_string())?,
        };
        boards.insert(board.id.clone(), board);
    }

    let mut folder_names = HashMap::new();
    let mut stmt = conn
        .prepare("SELECT id, name FROM folders")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let id: String = row.get(0).map_err(|e| e.to_string())?;
        let name: String = row.get(1).map_err(|e| e.to_string())?;
        folder_names.insert(id, name);
    }

    let mut items = Vec::new();
    let mut stmt = conn
        .prepare("SELECT item_type, item_id FROM index_items ORDER BY position ASC")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let item_type: String = row.get(0).map_err(|e| e.to_string())?;
        let item_id: String = row.get(1).map_err(|e| e.to_string())?;
        match item_type.as_str() {
            "board" => {
                if let Some(board) = boards.get(&item_id) {
                    items.push(BoardListItem::Board(board.clone()));
                }
            }
            "folder" => {
                if let Some(name) = folder_names.get(&item_id) {
                    let folder_items = load_folder_boards(conn, &item_id, &boards)?;
                    if !folder_items.is_empty() {
                        items.push(BoardListItem::Folder(BoardFolder {
                            id: item_id,
                            name: name.clone(),
                            items: folder_items,
                        }));
                    }
                }
            }
            _ => {}
        }
    }

    let active_board_id = get_setting(conn, "active_board_id")?;
    Ok(BoardsIndex {
        items,
        active_board_id,
    })
}

pub(crate) fn normalize_active_board_id(
    conn: &Connection,
    mut index: BoardsIndex,
) -> Result<BoardsIndex, String> {
    let next_active = match index.active_board_id.clone() {
        Some(id) if board_exists(&index.items, &id) => Some(id),
        _ => first_board_id(&index.items),
    };

    if index.active_board_id != next_active {
        set_setting(conn, "active_board_id", next_active.as_deref())?;
        index.active_board_id = next_active;
    }

    Ok(index)
}

pub(crate) fn insert_board_if_needed(
    conn: &Connection,
    app: &AppHandle,
    inserted: &mut HashSet<String>,
    board: &Board,
) -> Result<(), String> {
    if inserted.contains(&board.id) {
        return Ok(());
    }

    conn.execute(
        "INSERT OR IGNORE INTO boards (id, name, created_at, updated_at, collaboration_link, thumbnail)
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

    let board_path = get_board_data_path(app, &board.id)?;
    let data = if board_path.exists() {
        fs::read_to_string(&board_path).map_err(|e| e.to_string())?
    } else {
        default_board_data()
    };

    conn.execute(
        "INSERT OR REPLACE INTO board_data (board_id, data) VALUES (?1, ?2)",
        params![board.id, data],
    )
    .map_err(|e| e.to_string())?;

    inserted.insert(board.id.clone());
    Ok(())
}

pub(crate) fn get_board_by_id(conn: &Connection, board_id: &str) -> Result<Board, String> {
    let (
        id,
        name,
        created_at_ms,
        updated_at_ms,
        collaboration_link,
        thumbnail,
    ): (String, String, i64, i64, Option<String>, Option<String>) = conn
        .query_row(
            "SELECT id, name, created_at, updated_at, collaboration_link, thumbnail FROM boards WHERE id = ?1",
            params![board_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(Board {
        id,
        name,
        created_at: datetime_from_millis(created_at_ms)?,
        updated_at: datetime_from_millis(updated_at_ms)?,
        collaboration_link,
        thumbnail,
    })
}

pub(crate) fn load_board_data_value(
    conn: &Connection,
    board_id: &str,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT data FROM board_data WHERE board_id = ?1",
        params![board_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub(crate) fn board_exists(items: &[BoardListItem], board_id: &str) -> bool {
    items.iter().any(|item| match item {
        BoardListItem::Board(board) => board.id == board_id,
        BoardListItem::Folder(folder) => folder.items.iter().any(|board| board.id == board_id),
    })
}

pub(crate) fn first_board_id(items: &[BoardListItem]) -> Option<String> {
    for item in items {
        match item {
            BoardListItem::Board(board) => return Some(board.id.clone()),
            BoardListItem::Folder(folder) => {
                if let Some(board) = folder.items.first() {
                    return Some(board.id.clone());
                }
            }
        }
    }
    None
}
