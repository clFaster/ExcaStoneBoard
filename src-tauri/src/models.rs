use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

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
