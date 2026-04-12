use serde::Serialize;
use tauri::AppHandle;

use crate::db::{get_setting, open_db, set_setting};

const HIDE_EXPORT_ROW_SETTING_KEY: &str = "ui.hide_export_row";
const SHOW_TIMESTAMPS_SETTING_KEY: &str = "ui.show_timestamps";
const SIDEBAR_COLLAPSED_SETTING_KEY: &str = "ui.sidebar_collapsed";

#[derive(Serialize)]
pub(crate) struct UiPreferences {
    hide_export_row: Option<bool>,
    show_timestamps: Option<bool>,
    sidebar_collapsed: Option<bool>,
}

#[tauri::command]
pub(crate) fn get_ui_preferences(app: AppHandle) -> Result<UiPreferences, String> {
    let conn = open_db(&app)?;
    let hide_export_row = parse_optional_boolean_setting(
        get_setting(&conn, HIDE_EXPORT_ROW_SETTING_KEY)?,
        HIDE_EXPORT_ROW_SETTING_KEY,
    )?;
    let show_timestamps = parse_optional_boolean_setting(
        get_setting(&conn, SHOW_TIMESTAMPS_SETTING_KEY)?,
        SHOW_TIMESTAMPS_SETTING_KEY,
    )?;
    let sidebar_collapsed = parse_optional_boolean_setting(
        get_setting(&conn, SIDEBAR_COLLAPSED_SETTING_KEY)?,
        SIDEBAR_COLLAPSED_SETTING_KEY,
    )?;

    Ok(UiPreferences {
        hide_export_row,
        show_timestamps,
        sidebar_collapsed,
    })
}

#[tauri::command]
pub(crate) fn set_ui_preference(app: AppHandle, key: String, value: bool) -> Result<(), String> {
    let setting_key = match key.as_str() {
        "hide_export_row" => HIDE_EXPORT_ROW_SETTING_KEY,
        "show_timestamps" => SHOW_TIMESTAMPS_SETTING_KEY,
        "sidebar_collapsed" => SIDEBAR_COLLAPSED_SETTING_KEY,
        _ => return Err("Invalid UI preference key".to_string()),
    };

    let conn = open_db(&app)?;
    let setting_value = if value { "1" } else { "0" };
    set_setting(&conn, setting_key, Some(setting_value))
}

fn parse_optional_boolean_setting(value: Option<String>, key: &str) -> Result<Option<bool>, String> {
    let Some(raw) = value else {
        return Ok(None);
    };

    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" => Ok(Some(true)),
        "0" | "false" => Ok(Some(false)),
        _ => Err(format!("Invalid boolean setting value for key '{key}'")),
    }
}
