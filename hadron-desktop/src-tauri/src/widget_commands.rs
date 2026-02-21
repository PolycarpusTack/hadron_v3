use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindow};
use crate::error::{CommandResult, HadronError};

pub const WIDGET_LABEL: &str = "widget";
pub const MAIN_LABEL: &str = "main";

const MIN_WIDGET_DIMENSION: f64 = 48.0;
const MAX_WIDGET_WIDTH: f64 = 800.0;
const MAX_WIDGET_HEIGHT: f64 = 1200.0;

/// Get the widget window handle, if it exists
fn get_widget(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WIDGET_LABEL)
}

/// Toggle the widget window visibility
#[tauri::command]
pub async fn toggle_widget(app: AppHandle) -> CommandResult<()> {
    let widget = get_widget(&app)
        .ok_or_else(|| HadronError::Internal("Widget window not found".into()))?;
    if widget.is_visible()? {
        widget.hide()?;
    } else {
        widget.show()?;
        widget.set_focus()?;
    }
    Ok(())
}

/// Show and focus the widget
#[tauri::command]
pub async fn show_widget(app: AppHandle) -> CommandResult<()> {
    let widget = get_widget(&app)
        .ok_or_else(|| HadronError::Internal("Widget window not found".into()))?;
    widget.show()?;
    widget.set_focus()?;
    Ok(())
}

/// Hide the widget
#[tauri::command]
pub async fn hide_widget(app: AppHandle) -> CommandResult<()> {
    let widget = get_widget(&app)
        .ok_or_else(|| HadronError::Internal("Widget window not found".into()))?;
    widget.hide()?;
    Ok(())
}

/// Resize the widget window (for FAB <-> expanded transitions)
#[tauri::command]
pub async fn resize_widget(app: AppHandle, width: f64, height: f64) -> CommandResult<()> {
    if width < MIN_WIDGET_DIMENSION || width > MAX_WIDGET_WIDTH
        || height < MIN_WIDGET_DIMENSION || height > MAX_WIDGET_HEIGHT
        || width.is_nan() || height.is_nan()
    {
        return Err(HadronError::Validation(
            format!("Invalid widget dimensions: {}x{}", width, height),
        ));
    }
    let widget = get_widget(&app)
        .ok_or_else(|| HadronError::Internal("Widget window not found".into()))?;
    widget.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }))?;
    Ok(())
}

/// Show the main window and bring it to focus
#[tauri::command]
pub async fn focus_main_window(app: AppHandle) -> CommandResult<()> {
    let main = app
        .get_webview_window(MAIN_LABEL)
        .ok_or_else(|| HadronError::Internal("Main window not found".into()))?;
    main.show()?;
    main.unminimize()?;
    main.set_focus()?;
    Ok(())
}

/// Widget position for persistence
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetPosition {
    pub x: f64,
    pub y: f64,
}

/// Get the current widget window position
#[tauri::command]
pub async fn get_widget_position(app: AppHandle) -> CommandResult<WidgetPosition> {
    let widget = get_widget(&app)
        .ok_or_else(|| HadronError::Internal("Widget window not found".into()))?;
    let pos = widget.outer_position()?;
    let scale = widget.scale_factor()?;
    Ok(WidgetPosition {
        x: pos.x as f64 / scale,
        y: pos.y as f64 / scale,
    })
}

/// Move the widget window to a specific logical position
#[tauri::command]
pub async fn move_widget(app: AppHandle, x: f64, y: f64) -> CommandResult<()> {
    let widget = get_widget(&app)
        .ok_or_else(|| HadronError::Internal("Widget window not found".into()))?;
    widget.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))?;
    Ok(())
}

/// Check if the main window is currently visible and focused
#[tauri::command]
pub async fn is_main_window_visible(app: AppHandle) -> CommandResult<bool> {
    let main = app.get_webview_window(MAIN_LABEL);
    match main {
        Some(w) => Ok(w.is_visible()? && !w.is_minimized()?),
        None => Ok(false),
    }
}
