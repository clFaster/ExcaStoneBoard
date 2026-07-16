use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

use crate::db::get_boards_dir;

const THUMBNAILS_SUBDIR: &str = "thumbnails";
const DEFAULT_MIME: &str = "image/png";
const DEFAULT_EXTENSION: &str = "png";

/// Directory that holds all cached thumbnail files, created on demand.
pub(crate) fn thumbnails_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = get_boards_dir(app)?.join(THUMBNAILS_SUBDIR);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn file_path_for(app: &AppHandle, board_id: &str, extension: &str) -> Result<PathBuf, String> {
    Ok(thumbnails_dir(app)?.join(format!("{board_id}.{extension}")))
}

/// Relative path (as stored in the DB) for a given board id/extension pair.
fn relative_path_for(board_id: &str, extension: &str) -> String {
    format!("{THUMBNAILS_SUBDIR}/{board_id}.{extension}")
}

struct DecodedDataUrl {
    extension: String,
    bytes: Vec<u8>,
}

fn extension_from_mime(mime: &str) -> String {
    match mime {
        "image/jpeg" | "image/jpg" => "jpg".to_string(),
        "image/webp" => "webp".to_string(),
        _ => DEFAULT_EXTENSION.to_string(),
    }
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
        extension: extension_from_mime(mime),
        bytes,
    })
}

fn mime_from_extension(extension: &str) -> &'static str {
    match extension {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => DEFAULT_MIME,
    }
}

/// Removes any previously cached thumbnail file(s) for a board, regardless of extension.
fn remove_existing_files(app: &AppHandle, board_id: &str) -> Result<(), String> {
    for extension in ["png", "jpg", "jpeg", "webp"] {
        let path = file_path_for(app, board_id, extension)?;
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
    board_id: &str,
    data_url: Option<&str>,
) -> Result<Option<String>, String> {
    remove_existing_files(app, board_id)?;

    let Some(data_url) = data_url else {
        return Ok(None);
    };

    let decoded = decode_data_url(data_url)?;
    let path = file_path_for(app, board_id, &decoded.extension)?;
    fs::write(&path, &decoded.bytes).map_err(|error| error.to_string())?;

    Ok(Some(relative_path_for(board_id, &decoded.extension)))
}

/// Reads the thumbnail file referenced by `relative_path` (if any) and re-encodes it as a
/// data URL for the frontend.
pub(crate) fn load_thumbnail_data_url(
    app: &AppHandle,
    relative_path: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(relative_path) = relative_path else {
        return Ok(None);
    };

    let path = get_boards_dir(app)?.join(relative_path);
    if !path.exists() {
        return Ok(None);
    }

    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or(DEFAULT_EXTENSION);
    let mime = mime_from_extension(extension);
    let encoded = STANDARD.encode(bytes);

    Ok(Some(format!("data:{mime};base64,{encoded}")))
}

/// Deletes the cached thumbnail file(s) for a board, if any.
pub(crate) fn delete_thumbnail(app: &AppHandle, board_id: &str) -> Result<(), String> {
    remove_existing_files(app, board_id)
}

/// Copies the thumbnail file from `source_board_id` to `destination_board_id`, returning
/// the relative path of the new file (or `None` if the source has no thumbnail file).
pub(crate) fn copy_thumbnail(
    app: &AppHandle,
    source_board_id: &str,
    destination_board_id: &str,
) -> Result<Option<String>, String> {
    for extension in ["png", "jpg", "jpeg", "webp"] {
        let source_path = file_path_for(app, source_board_id, extension)?;
        if source_path.exists() {
            let destination_path = file_path_for(app, destination_board_id, extension)?;
            fs::copy(&source_path, &destination_path).map_err(|error| error.to_string())?;
            return Ok(Some(relative_path_for(destination_board_id, extension)));
        }
    }
    Ok(None)
}
