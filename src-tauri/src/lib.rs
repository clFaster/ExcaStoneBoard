use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
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

fn load_boards_index(app: &AppHandle) -> Result<BoardsIndex, String> {
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

fn save_boards_index(app: &AppHandle, index: &BoardsIndex) -> Result<(), String> {
    let index_path = get_index_path(app)?;
    let content = serde_json::to_string_pretty(index).map_err(|e| e.to_string())?;
    fs::write(&index_path, content).map_err(|e| e.to_string())
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

fn find_board<'a>(items: &'a [BoardListItem], board_id: &str) -> Option<&'a Board> {
    for item in items {
        match item {
            BoardListItem::Board(board) => {
                if board.id == board_id {
                    return Some(board);
                }
            }
            BoardListItem::Folder(folder) => {
                if let Some(board) = folder.items.iter().find(|b| b.id == board_id) {
                    return Some(board);
                }
            }
        }
    }
    None
}

fn find_board_mut<'a>(items: &'a mut Vec<BoardListItem>, board_id: &str) -> Option<&'a mut Board> {
    for item in items.iter_mut() {
        match item {
            BoardListItem::Board(board) => {
                if board.id == board_id {
                    return Some(board);
                }
            }
            BoardListItem::Folder(folder) => {
                if let Some(board) = folder.items.iter_mut().find(|b| b.id == board_id) {
                    return Some(board);
                }
            }
        }
    }
    None
}

fn remove_board(items: &mut Vec<BoardListItem>, board_id: &str) -> Option<Board> {
    let mut index = 0;
    while index < items.len() {
        match &mut items[index] {
            BoardListItem::Board(board) => {
                if board.id == board_id {
                    if let BoardListItem::Board(removed) = items.remove(index) {
                        return Some(removed);
                    }
                }
            }
            BoardListItem::Folder(folder) => {
                if let Some(pos) = folder.items.iter().position(|b| b.id == board_id) {
                    let removed = folder.items.remove(pos);
                    if folder.items.is_empty() {
                        items.remove(index);
                    }
                    return Some(removed);
                }
            }
        }
        index += 1;
    }
    None
}

fn get_board_data_path(app: &AppHandle, board_id: &str) -> Result<PathBuf, String> {
    let boards_dir = get_boards_dir(app)?;
    Ok(boards_dir.join(format!("{}.json", board_id)))
}

#[tauri::command]
fn get_boards(app: AppHandle) -> Result<BoardsIndex, String> {
    load_boards_index(&app)
}

#[tauri::command]
fn create_board(app: AppHandle, name: String) -> Result<Board, String> {
    let mut index = load_boards_index(&app)?;
    let now = Utc::now();

    let board = Board {
        id: Uuid::new_v4().to_string(),
        name,
        created_at: now,
        updated_at: now,
        collaboration_link: None,
        thumbnail: None,
    };

    // Create empty board data file
    let board_path = get_board_data_path(&app, &board.id)?;
    let empty_data = serde_json::json!({
        "excalidraw": null,
        "excalidraw-state": null
    });
    fs::write(
        &board_path,
        serde_json::to_string_pretty(&empty_data).unwrap(),
    )
    .map_err(|e| e.to_string())?;

    index.items.push(BoardListItem::Board(board.clone()));
    index.active_board_id = Some(board.id.clone());
    save_boards_index(&app, &index)?;

    Ok(board)
}

#[tauri::command]
fn rename_board(app: AppHandle, board_id: String, new_name: String) -> Result<Board, String> {
    let mut index = load_boards_index(&app)?;

    let board = find_board_mut(&mut index.items, &board_id).ok_or("Board not found")?;

    board.name = new_name;
    board.updated_at = Utc::now();
    let updated_board = board.clone();

    save_boards_index(&app, &index)?;

    Ok(updated_board)
}

#[tauri::command]
fn delete_board(app: AppHandle, board_id: String) -> Result<(), String> {
    let mut index = load_boards_index(&app)?;

    // Remove board data file
    let board_path = get_board_data_path(&app, &board_id)?;
    if board_path.exists() {
        fs::remove_file(&board_path).map_err(|e| e.to_string())?;
    }

    // Remove from index
    remove_board(&mut index.items, &board_id).ok_or("Board not found")?;

    // Update active board if deleted
    if index.active_board_id.as_ref() == Some(&board_id) {
        index.active_board_id = first_board_id(&index.items);
    }

    save_boards_index(&app, &index)?;

    Ok(())
}

#[tauri::command]
fn set_active_board(app: AppHandle, board_id: String) -> Result<(), String> {
    let mut index = load_boards_index(&app)?;

    // Verify board exists
    if !board_exists(&index.items, &board_id) {
        return Err("Board not found".to_string());
    }

    index.active_board_id = Some(board_id);
    save_boards_index(&app, &index)?;

    Ok(())
}

#[tauri::command]
fn save_board_data(app: AppHandle, board_id: String, data: String) -> Result<(), String> {
    let board_path = get_board_data_path(&app, &board_id)?;
    fs::write(&board_path, &data).map_err(|e| e.to_string())?;

    // Update the board's updated_at timestamp
    let mut index = load_boards_index(&app)?;
    if let Some(board) = find_board_mut(&mut index.items, &board_id) {
        board.updated_at = Utc::now();
        save_boards_index(&app, &index)?;
    }

    Ok(())
}

#[tauri::command]
fn load_board_data(app: AppHandle, board_id: String) -> Result<String, String> {
    let board_path = get_board_data_path(&app, &board_id)?;
    if board_path.exists() {
        fs::read_to_string(&board_path).map_err(|e| e.to_string())
    } else {
        Ok(serde_json::json!({
            "excalidraw": null,
            "excalidraw-state": null
        })
        .to_string())
    }
}

#[tauri::command]
fn set_collaboration_link(
    app: AppHandle,
    board_id: String,
    link: Option<String>,
) -> Result<(), String> {
    let mut index = load_boards_index(&app)?;

    let board = find_board_mut(&mut index.items, &board_id).ok_or("Board not found")?;

    board.collaboration_link = link;
    board.updated_at = Utc::now();

    save_boards_index(&app, &index)?;

    Ok(())
}

#[tauri::command]
fn duplicate_board(app: AppHandle, board_id: String, new_name: String) -> Result<Board, String> {
    let index = load_boards_index(&app)?;

    // Find the original board
    let original = find_board(&index.items, &board_id).ok_or("Board not found")?;

    // Load original board data
    let original_data = load_board_data(app.clone(), board_id)?;

    // Create new board
    let now = Utc::now();
    let new_board = Board {
        id: Uuid::new_v4().to_string(),
        name: new_name,
        created_at: now,
        updated_at: now,
        collaboration_link: None,
        thumbnail: original.thumbnail.clone(),
    };

    // Save duplicated board data
    let board_path = get_board_data_path(&app, &new_board.id)?;
    fs::write(&board_path, &original_data).map_err(|e| e.to_string())?;

    // Update index
    let mut index = load_boards_index(&app)?;
    index.items.push(BoardListItem::Board(new_board.clone()));
    save_boards_index(&app, &index)?;

    Ok(new_board)
}

#[tauri::command]
fn set_boards_index(app: AppHandle, items: Vec<BoardListItem>) -> Result<BoardsIndex, String> {
    let mut index = load_boards_index(&app)?;
    index.items = items;
    if let Some(active_id) = index.active_board_id.clone() {
        if !board_exists(&index.items, &active_id) {
            index.active_board_id = first_board_id(&index.items);
        }
    } else {
        index.active_board_id = first_board_id(&index.items);
    }
    save_boards_index(&app, &index)?;
    Ok(index)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
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
