use chrono::{DateTime, TimeZone, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Listener, Manager};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Board {
    pub id: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub collaboration_link: Option<String>,
    pub thumbnail: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BoardFolder {
    pub id: String,
    pub name: String,
    pub items: Vec<Board>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum BoardListItem {
    Board(Board),
    Folder(BoardFolder),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BoardsIndex {
    pub items: Vec<BoardListItem>,
    pub active_board_id: Option<String>,
}

impl Default for BoardsIndex {
    fn default() -> Self {
        BoardsIndex {
            items: Vec::new(),
            active_board_id: None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct BoardsIndexLegacy {
    pub boards: Vec<Board>,
    pub active_board_id: Option<String>,
}

fn get_boards_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let boards_dir = app_data.join("boards");
    fs::create_dir_all(&boards_dir).map_err(|e| e.to_string())?;
    Ok(boards_dir)
}

fn get_index_path(app: &AppHandle) -> Result<PathBuf, String> {
    let boards_dir = get_boards_dir(app)?;
    Ok(boards_dir.join("index.json"))
}

fn get_board_data_path(app: &AppHandle, board_id: &str) -> Result<PathBuf, String> {
    let boards_dir = get_boards_dir(app)?;
    Ok(boards_dir.join(format!("{}.json", board_id)))
}

fn default_board_data() -> String {
    serde_json::json!({
        "excalidraw": null,
        "excalidraw-state": null
    })
    .to_string()
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

fn board_exists(items: &[BoardListItem], board_id: &str) -> bool {
    items.iter().any(|item| match item {
        BoardListItem::Board(board) => board.id == board_id,
        BoardListItem::Folder(folder) => folder.items.iter().any(|board| board.id == board_id),
    })
}

fn first_board_id(items: &[BoardListItem]) -> Option<String> {
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

fn get_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let boards_dir = get_boards_dir(app)?;
    Ok(boards_dir.join("boards.db"))
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
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

fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn set_setting(conn: &Connection, key: &str, value: Option<&str>) -> Result<(), String> {
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

fn board_id_exists(conn: &Connection, board_id: &str) -> Result<bool, String> {
    let exists: i64 = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM boards WHERE id = ?1)",
            params![board_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(exists != 0)
}

fn first_board_id_from_db(conn: &Connection) -> Result<Option<String>, String> {
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

fn load_boards_index_from_db(conn: &Connection) -> Result<BoardsIndex, String> {
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

fn normalize_active_board_id(
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

fn insert_board_if_needed(
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

fn migrate_legacy_json_if_needed(app: &AppHandle, conn: &mut Connection) -> Result<(), String> {
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

fn get_board_by_id(conn: &Connection, board_id: &str) -> Result<Board, String> {
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

fn load_board_data_value(conn: &Connection, board_id: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT data FROM board_data WHERE board_id = ?1",
        params![board_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_boards(app: AppHandle) -> Result<BoardsIndex, String> {
    let conn = open_db(&app)?;
    let index = load_boards_index_from_db(&conn)?;
    normalize_active_board_id(&conn, index)
}

#[tauri::command]
fn create_board(app: AppHandle, name: String) -> Result<Board, String> {
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
fn rename_board(app: AppHandle, board_id: String, new_name: String) -> Result<Board, String> {
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
fn delete_board(app: AppHandle, board_id: String) -> Result<(), String> {
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
fn set_active_board(app: AppHandle, board_id: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    if !board_id_exists(&conn, &board_id)? {
        return Err("Board not found".to_string());
    }
    set_setting(&conn, "active_board_id", Some(&board_id))?;
    Ok(())
}

#[tauri::command]
fn save_board_data(app: AppHandle, board_id: String, data: String) -> Result<(), String> {
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
fn load_board_data(app: AppHandle, board_id: String) -> Result<String, String> {
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
fn set_collaboration_link(
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
fn duplicate_board(app: AppHandle, board_id: String, new_name: String) -> Result<Board, String> {
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
fn set_boards_index(app: AppHandle, items: Vec<BoardListItem>) -> Result<BoardsIndex, String> {
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
            set_boards_index
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
