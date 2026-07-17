use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::db::get_boards_dir;

const THUMBNAILS_SUBDIR: &str = "thumbnails";
const DEFAULT_MIME: &str = "image/png";

#[derive(Clone, Copy)]
pub(crate) struct BoardId<'a>(&'a str);

impl<'a> BoardId<'a> {
    fn as_str(self) -> &'a str {
        self.0
    }
}

impl<'a> From<&'a str> for BoardId<'a> {
    fn from(value: &'a str) -> Self {
        Self(value)
    }
}

#[derive(Clone, Copy)]
pub(crate) struct RelativeThumbnailPath<'a>(&'a str);

impl<'a> RelativeThumbnailPath<'a> {
    fn as_str(self) -> &'a str {
        self.0
    }
}

impl<'a> From<&'a str> for RelativeThumbnailPath<'a> {
    fn from(value: &'a str) -> Self {
        Self(value)
    }
}

#[derive(Clone, Copy)]
enum ThumbnailFormat {
    Png,
    Jpg,
    Jpeg,
    Webp,
}

impl ThumbnailFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpg => "jpg",
            Self::Jpeg => "jpeg",
            Self::Webp => "webp",
        }
    }

    fn mime(self) -> &'static str {
        match self {
            Self::Png => DEFAULT_MIME,
            Self::Jpg | Self::Jpeg => "image/jpeg",
            Self::Webp => "image/webp",
        }
    }

    fn from_mime_label(mime: &str) -> Self {
        match mime {
            "image/jpeg" | "image/jpg" => Self::Jpg,
            "image/webp" => Self::Webp,
            _ => Self::Png,
        }
    }

    fn from_path(path: &Path) -> Self {
        match path.extension().and_then(|ext| ext.to_str()) {
            Some("jpg") => Self::Jpg,
            Some("jpeg") => Self::Jpeg,
            Some("webp") => Self::Webp,
            _ => Self::Png,
        }
    }
}

const KNOWN_FORMATS: [ThumbnailFormat; 4] = [
    ThumbnailFormat::Png,
    ThumbnailFormat::Jpg,
    ThumbnailFormat::Jpeg,
    ThumbnailFormat::Webp,
];

/// Directory that holds all cached thumbnail files, created on demand.
pub(crate) fn thumbnails_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = get_boards_dir(app)?.join(THUMBNAILS_SUBDIR);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn file_path_for(
    app: &AppHandle,
    board_id: BoardId<'_>,
    format: ThumbnailFormat,
) -> Result<PathBuf, String> {
    Ok(thumbnails_dir(app)?.join(format!("{}.{}", board_id.as_str(), format.extension())))
}

/// Relative path (as stored in the DB) for a given board id/extension pair.
fn relative_path_for(board_id: BoardId<'_>, format: ThumbnailFormat) -> String {
    format!(
        "{THUMBNAILS_SUBDIR}/{}.{}",
        board_id.as_str(),
        format.extension()
    )
}

struct DecodedDataUrl {
    format: ThumbnailFormat,
    bytes: Vec<u8>,
}

fn decode_data_url(data_url: &str) -> Result<DecodedDataUrl, String> {
    let (header, payload) = data_url
        .split_once(',')
        .ok_or_else(|| "Invalid thumbnail data URL".to_string())?;

    let mime = header
        .strip_prefix("data:")
        .and_then(|rest| rest.split(';').next())
        .unwrap_or(DEFAULT_MIME);

    let bytes = STANDARD
        .decode(payload)
        .map_err(|error| format!("Failed to decode thumbnail data: {error}"))?;

    Ok(DecodedDataUrl {
        format: ThumbnailFormat::from_mime_label(mime),
        bytes,
    })
}

/// Removes any previously cached thumbnail file(s) for a board, regardless of extension.
fn remove_existing_files(app: &AppHandle, board_id: BoardId<'_>) -> Result<(), String> {
    for format in KNOWN_FORMATS {
        let path = file_path_for(app, board_id, format)?;
        if path.exists() {
            fs::remove_file(&path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

/// Persists a thumbnail data URL to a file for the given board, replacing any previous
/// thumbnail file. Returns the relative path to store in the DB (or `None` if `data_url`
/// is `None`, in which case any existing file is removed).
pub(crate) fn save_thumbnail(
    app: &AppHandle,
    board_id: BoardId<'_>,
    data_url: Option<&str>,
) -> Result<Option<String>, String> {
    remove_existing_files(app, board_id)?;

    let Some(data_url) = data_url else {
        return Ok(None);
    };

    let decoded = decode_data_url(data_url)?;
    let path = file_path_for(app, board_id, decoded.format)?;
    fs::write(&path, &decoded.bytes).map_err(|error| error.to_string())?;

    Ok(Some(relative_path_for(board_id, decoded.format)))
}

/// Reads the thumbnail file referenced by `relative_path` (if any) and re-encodes it as a
/// data URL for the frontend.
pub(crate) fn load_thumbnail_data_url(
    app: &AppHandle,
    relative_path: Option<RelativeThumbnailPath<'_>>,
) -> Result<Option<String>, String> {
    let Some(relative_path) = relative_path else {
        return Ok(None);
    };

    let path = get_boards_dir(app)?.join(relative_path.as_str());
    if !path.exists() {
        return Ok(None);
    }

    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    let mime = ThumbnailFormat::from_path(&path).mime();
    let encoded = STANDARD.encode(bytes);

    Ok(Some(format!("data:{mime};base64,{encoded}")))
}

/// Deletes the cached thumbnail file(s) for a board, if any.
pub(crate) fn delete_thumbnail(app: &AppHandle, board_id: BoardId<'_>) -> Result<(), String> {
    remove_existing_files(app, board_id)
}

/// Copies the thumbnail file from `source_board_id` to `destination_board_id`, returning
/// the relative path of the new file (or `None` if the source has no thumbnail file).
pub(crate) fn copy_thumbnail(
    app: &AppHandle,
    source_board_id: BoardId<'_>,
    destination_board_id: BoardId<'_>,
) -> Result<Option<String>, String> {
    for format in KNOWN_FORMATS {
        let source_path = file_path_for(app, source_board_id, format)?;
        if source_path.exists() {
            let destination_path = file_path_for(app, destination_board_id, format)?;
            fs::copy(&source_path, &destination_path).map_err(|error| error.to_string())?;
            return Ok(Some(relative_path_for(destination_board_id, format)));
        }
    }
    Ok(None)
}
